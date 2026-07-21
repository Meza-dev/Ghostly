import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let ghostDir: string;
let cursorMcpPath: string;
let mcpServerEntryPath: string;
let appData: string;
let homeDir: string;

vi.mock("../lib/paths.js", () => ({
  getAuthFile: () => join(ghostDir, "auth.json"),
  getCursorMcpPath: () => cursorMcpPath,
  getCursorRulesAssetsDir: () => join(tmpdir(), "ghostly-install-test-nonexistent-rules"),
  getCursorSkillsAssetsDir: () => join(tmpdir(), "ghostly-install-test-nonexistent-skills"),
  getMcpServerEntryPath: () => mcpServerEntryPath,
}));

vi.mock("../lib/playwright.js", () => ({
  isChromiumInstalled: () => true,
}));

// Claude Desktop es supported ahora (fase 3) — sandboxear sus rutas para que install.test.ts
// no toque el %APPDATA% real de la máquina que corre los tests.
vi.mock("../lib/mcp-clients/os-paths.js", () => ({
  appDataDir: () => appData,
  localAppDataDir: () => join(tmpdir(), "ghostly-install-test-nonexistent-localappdata"),
  macAppSupportDir: () => join(tmpdir(), "ghostly-install-test-nonexistent-appsupport"),
  isBinaryOnPath: () => false,
}));

// installGuidance() de Claude Desktop escribe bajo homedir()/.ghostly — sandboxearlo también.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir };
});

// Los clientes detect-only tocan fs/PATH real (home dir, `where`/`which`) — no nos importa
// su resultado acá, solo que no rompan el flujo no interactivo de --mcp-clients.
const { registerInstall } = await import("./install.js");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerInstall(program);
  return program;
}

describe("ghostly install --mcp-clients (non-interactive)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-install-test-"));
    ghostDir = join(dir, "ghost-home");
    mkdirSync(ghostDir, { recursive: true });
    cursorMcpPath = join(dir, "mcp.json");
    mcpServerEntryPath = join(dir, "mcp-server-index.js");
    appData = join(dir, "AppData", "Roaming");
    homeDir = join(dir, "home");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(mcpServerEntryPath, "// stub");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("--mcp-clients cursor injects only Cursor, end-to-end through the adapter", async () => {
    const program = buildProgram();

    await program.parseAsync(["node", "ghostly", "install", "--mcp-clients", "cursor"]);

    const written = JSON.parse(readFileSync(cursorMcpPath, "utf8")) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    const ghostly = written.mcpServers.ghostly;
    expect(ghostly).toBeDefined();
    expect(ghostly?.env.GHOST_API_KEY).toBeTruthy();
    expect(ghostly?.env.GHOST_API_URL).toBe("http://localhost:4000");
  });

  it("--mcp-clients with a detect-only/unknown id injects nothing and does not throw", async () => {
    const program = buildProgram();

    await program.parseAsync(["node", "ghostly", "install", "--mcp-clients", "codex,bogus"]);

    expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
  });

  it("--mcp-clients claude-desktop injects only Claude Desktop, end-to-end through the adapter", async () => {
    const program = buildProgram();

    await program.parseAsync(["node", "ghostly", "install", "--mcp-clients", "claude-desktop"]);

    const written = JSON.parse(
      readFileSync(join(appData, "Claude", "claude_desktop_config.json"), "utf8"),
    ) as { mcpServers: Record<string, { env: Record<string, string> }> };
    expect(written.mcpServers.ghostly?.env.GHOST_API_KEY).toBeTruthy();
    expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
  });
});
