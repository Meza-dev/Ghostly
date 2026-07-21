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
  getMcpServerEntryPath: () => mcpServerEntryPath,
}));

vi.mock("../lib/mcp-clients/os-paths.js", () => ({
  appDataDir: () => appData,
  localAppDataDir: () => join(tmpdir(), "ghostly-mcp-cmd-test-nonexistent-localappdata"),
  macAppSupportDir: () => join(tmpdir(), "ghostly-mcp-cmd-test-nonexistent-appsupport"),
  isBinaryOnPath: () => false,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir };
});

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  confirm: vi.fn(async () => true),
  isCancel: (v: unknown) => typeof v === "symbol",
}));

const { registerMcp } = await import("./mcp.js");
const p = await import("@clack/prompts");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerMcp(program);
  return program;
}

describe("ghostly mcp", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-mcp-cmd-test-"));
    ghostDir = join(dir, "ghost-home");
    mkdirSync(ghostDir, { recursive: true });
    cursorMcpPath = join(dir, "mcp.json");
    mcpServerEntryPath = join(dir, "mcp-server-index.js");
    appData = join(dir, "AppData", "Roaming");
    homeDir = join(dir, "home");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(mcpServerEntryPath, "// stub");
    process.exitCode = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function writeAuthFile() {
    writeFileSync(
      join(ghostDir, "auth.json"),
      JSON.stringify({ apiKey: "gk_test", apiUrl: "http://localhost:4000" }),
    );
  }

  describe("mcp add", () => {
    it("configures Cursor via the shared configure helper", async () => {
      writeAuthFile();
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "add", "cursor"]);

      const written = JSON.parse(readFileSync(cursorMcpPath, "utf8")) as {
        mcpServers: Record<string, { env: Record<string, string> }>;
      };
      expect(written.mcpServers.ghostly?.env.GHOST_API_KEY).toBe("gk_test");
    });

    it("configures Claude Desktop", async () => {
      writeAuthFile();
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "add", "claude-desktop"]);

      const written = JSON.parse(
        readFileSync(join(appData, "Claude", "claude_desktop_config.json"), "utf8"),
      ) as { mcpServers: Record<string, { env: Record<string, string> }> };
      expect(written.mcpServers.ghostly?.env.GHOST_API_KEY).toBe("gk_test");
    });

    it("errors clearly on an unknown client id, without writing anything", async () => {
      writeAuthFile();
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "add", "bogus"]);

      expect(process.exitCode).toBe(1);
      expect(p.log.error).toHaveBeenCalled();
      expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
    });

    it("refuses cleanly on a detect-only client, without writing anything", async () => {
      writeAuthFile();
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "add", "antigravity"]);

      expect(process.exitCode).toBe(1);
      expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("coming soon"));
      expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
    });

    it("errors with a clear message when no auth.json exists yet", async () => {
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "add", "cursor"]);

      expect(process.exitCode).toBe(1);
      expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("ghostly install"));
      expect(() => readFileSync(cursorMcpPath, "utf8")).toThrow();
    });
  });

  describe("mcp list", () => {
    it("prints installed/supported/configured status for every registered client", async () => {
      const program = buildProgram();

      await program.parseAsync(["node", "ghostly", "mcp", "list"]);

      const lines = (p.log.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (call) => String(call[0]),
      );
      expect(lines.some((l) => l.includes("Cursor"))).toBe(true);
      expect(lines.some((l) => l.includes("Claude Desktop"))).toBe(true);
      expect(lines.some((l) => l.includes("Claude Code"))).toBe(true);
      expect(lines.some((l) => l.includes("Antigravity") && l.includes("coming soon"))).toBe(true);
    });
  });
});
