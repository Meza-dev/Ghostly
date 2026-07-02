# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ghostly (formerly "GhostTester AI") is a **local-first, AI-driven E2E testing engine**. It generates and autonomously executes Playwright browser flows from a natural-language goal, self-heals failing selectors, and streams live progress to a web dashboard. It ships as a global npm CLI (`ghostly`, legacy alias `ghost`) under the `@ghostly-io` scope.

Key design constraint: **local-first / zero-trust** — API keys, secrets and source code stay on the developer's host; nothing is exfiltrated to external clouds. The LLM can be a user-provided HTTP endpoint (OpenAI-compatible) or a locally-installed CLI tool (e.g. Cursor CLI). All UI text and most code comments are in Spanish; match that when editing.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml` → `apps/*`, `packages/*`). Package manager is **pnpm 9.15.4**, Node **>=20**.

- `apps/api` — `@ghostly-io/api`. Hono HTTP server + Prisma (SQLite). The orchestration brain: exposes `/v1/*`, drives runs, and wraps the LLM.
- `apps/web` — `@ghostly-io/web`. React 19 + Vite + Tailwind dashboard (overview, runs, run detail, settings, LLM settings panel). `/flows` is still a placeholder.
- `packages/runner` — `@ghostly-io/runner`. The Playwright execution core and the **assisted-run pipeline** (strategist/observer/healer). Pure engine — receives LLM callbacks, does not talk to any LLM itself.
- `packages/mcp-server` — `@ghostly-io/mcp-server`. MCP (Model Context Protocol) stdio server so IDEs (Cursor) can call Ghostly tools (`ghostly_run_flow`, project map, submit plan, etc.).
- `packages/scanner` — `@ghostly-io/scanner`. Static AST scan of the target repo → project map / route manifest (used by MCP and code hints).
- `packages/cli` — `@ghostly-io/cli`. The `ghostly` command (`keygen`, `install`, `config`, `up`, `update`).
- `packages/client` — typed API client. `packages/tsconfig` — shared TS config.

## Commands

Run from the repo root unless noted. All builds/typechecks are per-package via pnpm filters.

```bash
# Install deps
pnpm install

# Dev: runner + api in parallel (watch mode)
pnpm dev
pnpm dev:api          # api only
pnpm dev:web          # web only (Vite)

# Build everything / typecheck everything
pnpm build
pnpm typecheck        # runs tsc --noEmit across runner, api, mcp-server, scanner, web

# Playwright browser (required before first run)
pnpm pw:install       # installs chromium into the runner package

# Scanner (static project map) against a target
pnpm scan

# Runner tests (vitest) — the only package with a test suite
pnpm --filter @ghostly-io/runner test
pnpm --filter @ghostly-io/runner test <file>           # single test file
pnpm --filter @ghostly-io/runner exec vitest run -t "name"   # single test by name

# Database (Prisma, from apps/api or via filter)
pnpm --filter @ghostly-io/api db:migrate       # apply migrations (prod)
pnpm --filter @ghostly-io/api db:migrate:dev   # create+apply during dev
pnpm --filter @ghostly-io/api db:generate      # regenerate client after schema edits
pnpm --filter @ghostly-io/api db:studio
pnpm --filter @ghostly-io/api db:seed
```

After editing `apps/api/prisma/schema.prisma`, run `db:migrate:dev` then `db:generate`.

## Runtime architecture

### Assisted run — the core loop
A run turns a natural-language `goal` into browser actions. Responsibility is split across two packages:

- **`packages/runner/src/assist/pipeline.ts`** (`runAssistedFlow`) owns the loop: it advances a `planProgress` list in *horizons*, executes steps with Playwright, and after each step captures an **observer snapshot** (`observer.ts` — a11y tree + visible DOM form controls). It calls back into two injected functions:
  - **strategist** — decides the next steps from the goal + current page snapshot + memory.
  - **healer** — when a selector fails 2+ times, proposes a corrected selector from the observed DOM map.
  These are provided by the API as `AssistedDeps`; the runner never imports an LLM.
- **`apps/api/src/services/assist-orchestrator.ts`** builds the real strategist/healer by wrapping the LLM (`createStrategist`, `createHealer`) with the large Spanish prompt engineering (selector-fatigue rules, victory conditions, DOM-control priority). `assist-plan.ts` handles up-front plan generation.
- **`recon.ts`** does an initial page reconnaissance; **`healer.ts`** also sanitizes healer output.

Successful assisted runs are stored as **`AssistMemory`** (keyed by user+project+baseUrl+goal) and replayed to speed up / stabilize future runs (`replayFromMemory`).

### API surface (`apps/api/src/app.ts`)
Hono app mounted under `/v1`. Middleware order matters:
1. `apiKeyMiddleware` guards all `/v1/*` with the Ghostly API key (except `/v1/auth/login`).
2. `authMiddleware` (JWT/session user) — except login.
3. `attachUserLlmMiddleware` loads the user's LLM settings.

Routers: `auth`, `run`, `run-events`, `plan`, `projects`, `api-keys`, `llm-settings`. The app also serves `/artifacts/*` (screenshots/video/traces) and, when `GHOST_WEB_DIR` is set (packaged CLI), serves the built web SPA with fallback to `index.html`.

### Live run streaming
Runs emit `AssistEvent`s. `services/run-event-bus.ts` is an in-process pub/sub; `routes/run-events.ts` exposes them as SSE to the web UI; `services/run-control.ts` (`runControlRegistry`) lets the UI pause/abort a run. Events are also persisted as `RunEvent` rows for replay. `lib/redact-assist.ts` scrubs secrets from persisted assist metadata.

### LLM abstraction (`apps/api/src/llm/`)
Provider-agnostic. `factory.ts` + `providers/` select between `http-openai.ts` (any OpenAI-compatible endpoint) and `cli.ts` (spawns a local CLI binary — resolved via `resolve-cli-bin.ts` / `cli-registry.ts`). `catalog.ts` lists known providers/models; `context.ts` uses AsyncLocalStorage (`runWithLlmConfigAsync`) so each request runs with the calling user's resolved config. User overrides live in the `UserLlmSettings` table (`store/llm-settings.ts`) and fall back to env vars. See `docs/cursor-cli-llm-provider.md` for the CLI-provider design.

### Data model (`apps/api/prisma/schema.prisma`, SQLite)
`User` → `ApiKey`, `Project`, `Run`, `AssistMemory`, `UserLlmSettings`. `Run` → `Step` + `RunEvent`. Runs carry `assistedMeta`, `codeHintsJson`, `videoPath`, `contextId`.

## Conventions & gotchas

- **ESM everywhere** (`"type": "module"`). Intra-repo imports use `.js` extensions in TS source (NodeNext resolution) — keep that even when importing `.ts` files.
- Workspace deps use `workspace:*`; the runner is consumed by api and mcp-server as a built package (`dist/`), so **rebuild the runner** (`pnpm --filter @ghostly-io/runner build`) after changing it if a consumer imports from `dist`.
- The runner is the only package with tests (vitest). Prefer adding pipeline/schema tests there.
- Spanish is the product language — UI strings, prompts and comments are Spanish. Follow suit.
- SQLite `dev.db` is local; `DATABASE_URL` in `.env` may be blank in dev (schema hardcodes `file:./dev.db`).

## AI workflow conventions

These mirror the Cursor rules (`~/.cursor/rules/*.mdc`) so behaviour is consistent across Cursor and Claude Code. The Engram and Kanon MCP servers referenced below are configured; Engram is always connected, Kanon needs its local server on `:3333`.

### Persistent memory — Engram (always active)
Engram is a cross-session memory (`mem_*` MCP tools). Use it without being asked:
- **Save proactively** (`mem_save`) after: an architecture/design decision, a convention established, a bug fix (include root cause), a non-obvious implementation, a config/env change, or a gotcha discovered. Use a stable `topic_key` (e.g. `architecture/auth-model`) for evolving topics so updates upsert instead of duplicating. Skip for trivial one-line fixes and pure Q&A.
- **Search** (`mem_context` → then `mem_search` → then `mem_get_observation` for full text) when the user says "recordá/qué hicimos/how did we solve", or before starting work that may have been done before.
- **Session close / after compaction:** call `mem_session_summary` before saying "listo/done" and immediately after any compaction, or the next session starts blind.
- The `engram-workflow` skill encodes the full protocol; it applies to substantial work only.

### Spec-Driven Development (SDD)
For substantial changes, use the installed `sdd-*` skills instead of ad-hoc edits. Dependency chain:
`explore → propose → spec + design → tasks → apply → verify → archive`.
Artifacts persist in Engram by default (topic keys `sdd/<change>/<phase>`). `/sdd-new`, `/sdd-continue`, `/sdd-ff` orchestrate the sequence. Default to interactive mode (review between phases) unless told otherwise.

### E2E test design — Ghostly Expert Architect (project-specific)
When the work involves E2E signals (`e2e`, `run_flow`, `submit_plan`, `flaky`, `victory condition`, `selector`, `manifest`, `plan de prueba`), follow this order via the `ghostly` MCP tools:
1. `get_project_map` first.
2. `read_flow_docs` if applicable.
3. `analyze_component` to obtain **stable selectors** for the components involved.
4. Design a logical **victory condition** — a success message, expected URL, or visible evidence of the final state.
5. Validate first with `ghostly_run_flow`.
6. Only after success, persist with `submit_plan` (include `codeHints` and `assistV2`).

**Anti-flakiness:** selector priority `data-testid` > `aria-label` > `id` > `name` > `placeholder` > text. Avoid ambiguous selectors (`button`, `input`, `form button`) when a stable alternative exists; if a selector fails, analyse the error, adjust selector/wait, and retry rather than repeating the same one.

### Project management — Kanon (optional)
When a bug/feature/task should be tracked, use the `kanon_*` MCP tools: `kanon_create_issue` (title `[Area] Verb phrase`, check `kanon_list_groups` first), `kanon_transition_issue`/`kanon_update_issue` to keep the board in sync, and `kanon_create_roadmap_item` to capture deferred ideas. Requires the Kanon server running on `:3333`.
