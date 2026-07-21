import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpEntry } from "./types.js";

let cursorMcpPath: string;

vi.mock("../paths.js", () => ({
  getCursorMcpPath: () => cursorMcpPath,
  getCursorRulesAssetsDir: () => join(tmpdir(), "ghostly-nonexistent-rules"),
  getCursorSkillsAssetsDir: () => join(tmpdir(), "ghostly-nonexistent-skills"),
}));

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

  it("installGuidance() does not throw when no bundled assets exist", () => {
    expect(() => cursorClient.installGuidance?.()).not.toThrow();
  });
});
