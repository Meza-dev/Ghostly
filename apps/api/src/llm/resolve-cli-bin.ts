import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Ruta al binario `agent` de Cursor (Windows suele necesitar la ruta completa al .cmd). */
export function resolveCursorAgentBin(): string {
  const fromEnv = process.env.CURSOR_AGENT_BIN?.trim();
  if (fromEnv) return fromEnv;

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) {
      const cmd = join(localAppData, "cursor-agent", "cursor-agent.cmd");
      if (existsSync(cmd)) return cmd;
    }
  }

  return "agent";
}

export function resolveCliBin(providerId: string, defaultBin: string): string {
  const generic = process.env.ASSIST_CLI_BIN?.trim();
  if (generic) return generic;
  if (providerId === "cursor-cli") return resolveCursorAgentBin();
  return defaultBin;
}

/**
 * ¿El binario es un script de Windows (.cmd/.bat/.ps1)? Estos NO son ejecutables
 * nativos: para lanzarlos SIN shell hay que invocar `cmd.exe /c <script> ...args`
 * con los argumentos como elementos separados del array (windowsVerbatimArguments
 * = false), de modo que Node haga el quoting por argumento. NUNCA usamos
 * `shell: true` (C1): eso aplanaría los args en una línea que cmd.exe reinterpreta,
 * habilitando inyección de comandos vía el campo `model`. La rama `bin === "agent"`
 * fue eliminada: el binario pelado se ejecuta directo (ENOENT si no está instalado).
 */
export function isWindowsCmdScript(bin: string): boolean {
  if (process.platform !== "win32") return false;
  return bin.endsWith(".cmd") || bin.endsWith(".bat") || bin.endsWith(".ps1");
}

/** Raíz del monorepo o cwd; evita pasar --workspace con espacios (rompe shell en Windows). */
export function resolveDefaultCliWorkspace(): string {
  const fromEnv =
    process.env.CURSOR_AGENT_WORKSPACE?.trim() ||
    process.env.ASSIST_CLI_WORKSPACE?.trim();
  if (fromEnv) return fromEnv;

  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
