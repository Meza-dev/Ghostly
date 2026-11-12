# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ghostly (formerly "GhostTester AI") is a **local-first, AI-driven E2E testing engine**. It generates and autonomously executes Playwright browser flows from a natural-language goal, self-heals failing selectors, and streams live progress to a web dashboard. It ships as a global npm CLI (`ghostly`, legacy alias `ghost`) under the `@ghostly-io` scope.

Key design constraint: **local-first / zero-trust** — API keys, secrets and source code stay on the developer's host; nothing is exfiltrated to external clouds. The LLM can be a user-provided HTTP endpoint (OpenAI-compatible) or a locally-installed CLI tool (e.g. Cursor CLI). All UI text and most code comments are in Spanish; match that when editing.

## Versioning

Ghostly is at **0.1.x** (product milestone **v0.2 "Trust Release"**). **Do not bump the version (major/minor) for every feature.** Only bump when the user explicitly approves, or when you propose a concrete number (e.g. "this is a 0.2.1 vs 0.3 vs 1.0") and the user confirms. Never jump to v3/v4 for a single feature. Mental model: like Cursor/Claude — near-daily updates but not version 20/30. Note: a **`v4.x`** seen in test output is **Vitest** (the runner), not Ghostly.

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
- **The user-facing surface is bilingual EN/ES, English-first** — never hardcode UI strings. Web: call `t("key")` from `useLanguage()` (`apps/web/src/context/language-context.tsx`); add the English text to `apps/web/src/i18n/en.ts` (source of truth) and the Spanish to `es.ts`. `es.ts` is typed `Record<MessageKey, string>`, so a missing translation is a **compile error**. API error messages come from `apps/api/src/i18n/messages.ts` selected via the `Accept-Language` header. The CLI is English-only.
  - Module-level maps can't call the hook — hold `MessageKey`s and resolve with `t()` at the render site (see `verdict.ts`).
  - **LLM prompts and code comments stay Spanish** (repo convention). Never translate strings scraped from the target app (aria-label, placeholder) — they're the user's data, not our copy.
- SQLite `dev.db` is local; `DATABASE_URL` in `.env` may be blank in dev (schema hardcodes `file:./dev.db`).
- **`main` is protected**: direct pushes are rejected (*"Changes must be made through a pull request"*). Land everything via PR — push a branch, then `gh pr create --base main`. The repo is **public**: `docs/security-audit-*.md` and `docs/docker-deployment.md` are gitignored and must never be committed.
- `pnpm typecheck` covers the whole monorepo and is green — keep it that way. `packages/tsconfig/base.json` sets `noUncheckedIndexedAccess`, so indexed access (`m[1]`, `arr[i]`) is `T | undefined`: guard it, don't assert it away with `!` or `as`.

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

### Testing and security hygiene with Ghostly MCP

| User intent | Tool and action |
| --- | --- |
| Find useful repository tests | `ghostly_init` without `module` discovers up to three ranked unit cases in `mode: "plan"`. Use `mode: "apply"` to generate and run one supported unit case with no apparent coverage. Report `needs_input` when no case qualifies. |
| Test a unit or integration in a module | `ghostly_test_unit` or `ghostly_test_integration` with the relative module path. Follow the repository's test conventions and use an independently documented expectation. Report baseline and generated test results separately. |
| Generate a versionable browser persistence test | `ghostly_test_e2e` with a loopback origin, synthetic data and stable test IDs. Check the visible save confirmation and the saved record after reload. |
| Run or save a browser flow | Validate with `ghostly_run_flow`. Use `submit_plan` only when the user asks to save it. Get the project ID with `list_ghostly_projects` and check the saved run with `get_run`. |
| Review security hygiene | `ghostly_audit_security` performs a bounded, static, read-only review. Honor any relative `scope` and report evidence, impact, mitigation and coverage gaps. |

Save a validated flow with deterministic replay by default by omitting `assistV2`. Set `assistV2: true` only when the user asks for Ghostly's self-healing and judge supervision.

Use `get_project_map`, `read_flow_docs` and `analyze_component` as needed for browser selectors. Pass the absolute `projectRoot` to those tools and `submit_plan` when the MCP client runs outside the target project. Run browser flows against a test environment with synthetic data.

Report assertion failures as failures. If a selector is wrong, correct it and replay the same check. Return the generated test path and replay command, including any required environment settings.

### Project management — Kanon (optional)
When a bug/feature/task should be tracked, use the `kanon_*` MCP tools: `kanon_create_issue` (title `[Area] Verb phrase`, check `kanon_list_groups` first), `kanon_transition_issue`/`kanon_update_issue` to keep the board in sync, and `kanon_create_roadmap_item` to capture deferred ideas. Requires the Kanon server running on `:3333`.
