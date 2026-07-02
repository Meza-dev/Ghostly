# Setup de una compu nueva — entorno AI (Ghostly + Cursor + Claude Code)

Guía para dejar una máquina nueva **igual que la actual**: mismos MCP, skills y reglas en Cursor y Claude Code, más las herramientas del ecosistema. Pensado para Windows 11 + PowerShell.

> **Ruta rápida:** instala prerequisitos → instala `gentle-ai` (sincroniza skills/config en todos los agentes) → instala las CLIs (ghostly, codebase-memory-mcp) → corre `scripts/setup-claude-code.ps1` → clona este repo (trae el `CLAUDE.md`).

---

## 1. Prerequisitos

| Herramienta | Cómo instalar | Verificar |
|---|---|---|
| **Node.js 20+** | https://nodejs.org (o `winget install OpenJS.NodeJS.LTS`) | `node -v` |
| **pnpm 9** | `npm i -g pnpm@9` | `pnpm -v` |
| **git** | `winget install Git.Git` | `git --version` |
| **Cursor** | https://cursor.com/download | abre la app |
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` (o instalador oficial) | `claude --version` |

---

## 2. Ecosistema de agentes (gentle-ai)

`gentle-ai` (de Gentleman-Programming) instala/sincroniza engram, skills y configs en **todos los agentes detectados** (Cursor, Claude Code, Antigravity, Codex…). Es el "unificador".

```powershell
# Instalar gentle-ai (canal stable)
irm https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.ps1 | iex

# Al abrir gentle-ai, deja que haga el sync inicial (instala engram + skills + reglas).
# Si el "pre-upgrade backup" tarda mucho es porque copia .cursor/.gemini enteros; déjalo terminar una vez.
gentle-ai
```

Esto deja en `~/.cursor/skills`, `~/.cursor/rules`, y en Claude Code los skills SDD y de gentleman.

---

## 3. CLIs propias del proyecto

```powershell
# Ghostly CLI (motor E2E + su MCP server)
npm i -g @ghostly-io/cli
ghostly keygen        # genera credenciales locales (NUEVA api key para esta máquina)
ghostly install       # instala el MCP de ghostly en los IDEs detectados
ghostly up            # levanta el motor/API en localhost:4000

# codebase-memory-mcp (memoria/índice del codebase) — instalar desde su release
#   deja el exe en: %LOCALAPPDATA%\Programs\codebase-memory-mcp\codebase-memory-mcp.exe

# Kanon (gestión de proyecto) — si lo usas, se configura con su link:
#   kanon-setup kanon://...   (trae skills kanon-* y su MCP wrapper en ~/.kanon)
```

> La **API key de ghostly es por máquina**: usa la que genere `ghostly keygen` aquí, no copies la de la otra compu.

---

## 4. Configurar Claude Code (automático)

Corre el script incluido — registra el plugin engram, los 5 MCP y copia los skills que falten:

```powershell
# Desde la raíz del repo. Pasa la API key de ghostly de ESTA máquina:
$env:GHOST_API_KEY = "<pega-la-key-de-ghostly-keygen>"
powershell -ExecutionPolicy Bypass -File scripts/setup-claude-code.ps1
```

### …o manual (si prefieres no usar el script)

```powershell
# Plugin engram (trae engram MCP + skills sdd/gentle-ai)
claude plugin marketplace add Gentleman-Programming/engram
claude plugin install engram@engram

# Los 5 MCP (scope user). Ajusta rutas/keys a esta máquina:
$node = (Get-Command node).Source
claude mcp add context7 -s user -- npx -y "@upstash/context7-mcp"
claude mcp add kanon-mcp -s user --env KANON_WORKSPACE_ID=4376a38a-41eb-4b2a-a323-1b24301fa8d2 -- $node "$env:USERPROFILE\.kanon\mcp\mcp\dist\wrapper-cli.js" --server http://localhost:3333
claude mcp add ghostly -s user --env GHOST_API_KEY=$env:GHOST_API_KEY --env X_API_KEY=$env:GHOST_API_KEY --env GHOST_API_URL=http://localhost:4000 -- $node "$env:APPDATA\npm\node_modules\@ghostly-io\cli\dist\assets\mcp-server\index.js"
claude mcp add codebase-memory-mcp -s user -- "$env:LOCALAPPDATA\Programs\codebase-memory-mcp\codebase-memory-mcp.exe"

# Skills que no vienen del plugin (si no los trajo gentle-ai), cópialos desde Cursor:
$dst = "$env:USERPROFILE\.claude\skills"
foreach ($s in "kanon-agent","kanon-init","kanon-onboard","engram-workflow") {
  Copy-Item "$env:USERPROFILE\.cursor\skills\$s" "$dst\$s" -Recurse -Force -ErrorAction SilentlyContinue
}
```

**Reinicia Claude Code** para que cargue los MCP nuevos. Verifica con `claude mcp list`.

---

## 5. Configurar Cursor (parity)

Si `gentle-ai` no dejó todo igual, copia la config de la máquina vieja (o de tu backup):

- `~/.cursor/mcp.json` — los 5 MCP (⚠️ actualiza la API key de ghostly de esta máquina).
- `~/.cursor/rules/` — `engram-workflow.mdc`, `gentle-ai.mdc`, `ghosttester-expert-architect.mdc`, `kanon.mdc`.
- `~/.cursor/skills/` — carpetas SDD, kanon-*, engram-workflow, etc.

---

## 6. El proyecto Ghostly

```powershell
git clone https://github.com/Meza-dev/Ghostly.git
cd Ghostly
pnpm install
pnpm pw:install                                   # chromium para Playwright
pnpm --filter @ghostly-io/api db:migrate          # crea la SQLite
pnpm dev                                           # runner + api
```

El repo ya incluye **`CLAUDE.md`** con las convenciones (memoria Engram, SDD, protocolo E2E Ghostly, Kanon) — se carga solo en cada sesión de Claude Code.

---

## 7. Checklist de verificación

- [ ] `claude mcp list` → engram, context7, ghostly, codebase-memory-mcp ✔ (kanon ✔ solo si su server `:3333` corre)
- [ ] Skills en `~/.claude/skills`: sdd-*, kanon-*, engram-workflow, find-skills
- [ ] Cursor: `~/.cursor/mcp.json` con 5 MCP y `~/.cursor/rules` con las 4 reglas
- [ ] `ghostly up` responde en `http://localhost:4000/health`
- [ ] `pnpm typecheck` pasa en el repo

> ⚠️ **Seguridad:** el `mcp.json` y la config guardan la API key de ghostly en claro. No subas esos archivos a ningún repo público.
