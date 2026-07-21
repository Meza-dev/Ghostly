import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpEntry } from "./types.js";

let cursorMcpPath: string;
let homeDir: string;

vi.mock("../paths.js", () => ({
  getCursorMcpPath: () => cursorMcpPath,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir };
});

const { cursorClient } = await import("./cursor.js");

const entry: McpEntry = {
  command: "node",
  args: ["/abs/index.js"],
  env: { GHOST_API_KEY: "k", GHOST_API_URL: "u" },
};

describe("cursorClient", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-cursor-test-"));
    cursorMcpPath = join(dir, "mcp.json");
    homeDir = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detect() is false when no mcp.json exists yet", () => {
    expect(cursorClient.detect()).toBe(false);
  });

  it("detect() is true once mcp.json exists", () => {
    writeFileSync(cursorMcpPath, JSON.stringify({ mcpServers: {} }));
    expect(cursorClient.detect()).toBe(true);
  });

  it("isConfigured() flips from false to true after inject()", () => {
    expect(cursorClient.isConfigured()).toBe(false);
    cursorClient.inject(entry);
    expect(cursorClient.isConfigured()).toBe(true);
  });

  it("inject() writes the entry while preserving other servers", () => {
    writeFileSync(cursorMcpPath, JSON.stringify({ mcpServers: { other: { command: "y", args: [] } } }));

    const result = cursorClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(cursorMcpPath, "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
    expect(written.mcpServers.other).toEqual({ command: "y", args: [] });
  });

  it("installGuidance() writes a rule sourced from the shared guidance markdown", () => {
    cursorClient.installGuidance?.();

    const written = readFileSync(join(dir, ".cursor", "rules", "ghostly-expert.mdc"), "utf8");
    expect(written).toContain("alwaysApply: true");
    expect(written).toContain("get_project_map");
    expect(written).toContain("ghostly_run_flow");
    expect(written).toContain("submit_plan");
  });
});
