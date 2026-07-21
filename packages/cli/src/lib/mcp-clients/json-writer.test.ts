import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeMcpServerIntoJsonFile } from "./json-writer.js";
import type { McpEntry } from "./types.js";

const entry: McpEntry = {
  command: "node",
  args: ["/abs/index.js"],
  env: { GHOST_API_KEY: "k", GHOST_API_URL: "u" },
};

describe("mergeMcpServerIntoJsonFile", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-mcp-test-"));
    configPath = join(dir, "mcp.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file and parent dir when absent", () => {
    const nestedPath = join(dir, "nested", "mcp.json");
    const result = mergeMcpServerIntoJsonFile(nestedPath, "ghostly", entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(nestedPath, "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
  });

  it("preserves existing unrelated servers when merging", () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }));

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(written.mcpServers.ghostly).toEqual(entry);
  });

  it("backs up and aborts without overwriting on malformed JSON", () => {
    writeFileSync(configPath, "{ not valid json");

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("skipped-backup");
    expect(readFileSync(configPath, "utf8")).toBe("{ not valid json");
    const backup = readdirSync(dir).find((f) => f.startsWith("mcp.json.ghostly-backup-"));
    expect(backup).toBeDefined();
  });

  it("backs up and aborts on an empty file", () => {
    writeFileSync(configPath, "");

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("skipped-backup");
    expect(readFileSync(configPath, "utf8")).toBe("");
    const backup = readdirSync(dir).find((f) => f.startsWith("mcp.json.ghostly-backup-"));
    expect(backup).toBeDefined();
  });

  it("adds mcpServers to a valid config that lacks it, preserving other keys", () => {
    // Caso ~/.claude.json de Claude Code: objeto válido con otras claves, sin mcpServers.
    writeFileSync(configPath, JSON.stringify({ projects: { a: 1 }, theme: "dark" }));

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.projects).toEqual({ a: 1 });
    expect(written.theme).toBe("dark");
    expect(written.mcpServers.ghostly).toEqual(entry);
  });

  it("backs up and aborts when mcpServers is present but the wrong type", () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: "nope" }));

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("skipped-backup");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ mcpServers: "nope" });
  });

  it("backs up and aborts on non-object JSON (array)", () => {
    writeFileSync(configPath, JSON.stringify([1, 2, 3]));

    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("skipped-backup");
  });

  it("is idempotent across repeated runs", () => {
    mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);
    const result = mergeMcpServerIntoJsonFile(configPath, "ghostly", entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
  });
});
