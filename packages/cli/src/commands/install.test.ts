import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let ghostDir: string;
let cursorMcpPath: string;
let mcpServerEntryPath: string;

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

  it("--mcp-clients with an unsupported/unknown id injects nothing and does not throw", async () => {
    const program = buildProgram();

    await program.parseAsync(["node", "ghostly", "install", "--mcp-clients", "claude-desktop,bogus"]);

    expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
  });
});
