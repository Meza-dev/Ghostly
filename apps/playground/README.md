# Ghostly Playground

Disposable test-target app for Ghostly. NOT a real product — fast/simple over correct, no tests, no security, no polish.

## Run

```bash
pnpm playground
```

Serves at http://localhost:4700 (single Vite process; `/api/*` is a fake in-memory backend implemented as a Vite plugin — see `src/server/plugin.ts`).

## Flow

Login (any non-empty user/pass) → Clientes (CRUD) → Pedidos (list + create) → Ajustes (failure injection panel).

## Failure panel (Ajustes)

Toggles POST to `/api/config` and affect all subsequent `/api/*` responses:

- `fail-on-save` — POST/PUT return HTTP 500
- `non-persisting-save` — 200 + success toast, but data isn't stored
- `validation-rejects` — 422 with a visible validation error
- `blocking-modal` — overlay covers the main UI until dismissed
- `slow` — ~3s delay on all responses
- `reset-data` — restores the seed data and resets config

Also settable via query param, e.g. `http://localhost:4700/clientes?fail=save`.
