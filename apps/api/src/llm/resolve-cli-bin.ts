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

/** En Windows, .cmd/.bat requieren shell para spawn. */
export function needsShellForCli(bin: string): boolean {
  if (process.platform !== "win32") return false;
  if (bin.endsWith(".cmd") || bin.endsWith(".bat") || bin.endsWith(".ps1")) return true;
  return bin === "agent";
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
