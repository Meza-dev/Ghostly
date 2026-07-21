import { describe, expect, it, vi } from "vitest";

vi.mock("../paths.js", () => ({
  getCursorMcpPath: () => "/nonexistent/mcp.json",
  getCursorRulesAssetsDir: () => "/nonexistent/rules",
  getCursorSkillsAssetsDir: () => "/nonexistent/skills",
}));

// Los adapters detect-only tocan fs/PATH reales (home dir, `where`/`which`); no importa el
// valor exacto acá, solo que detectClients() nunca explote y devuelva un boolean por cliente.
const { registry, detectClients } = await import("./registry.js");

describe("registry", () => {
  it("registers Cursor (supported) + the detect-only clients, in order", () => {
    expect(registry.map((c) => c.id)).toEqual([
      "cursor",
      "claude-desktop",
      "claude-code",
      "antigravity",
      "codex",
      "opencode",
    ]);
  });

  it("Cursor and Claude Desktop are supported today; the rest are detect-only", () => {
    expect(registry.filter((c) => c.supported).map((c) => c.id)).toEqual(["cursor", "claude-desktop"]);
  });

  it("detectClients() resolves adapter + boolean installed flag for every registered client, without crashing", () => {
    const result = detectClients();

    expect(result).toHaveLength(registry.length);
    expect(result[0]?.client.id).toBe("cursor");
    expect(result[0]?.installed).toBe(false);
    for (const entry of result) {
      expect(typeof entry.installed).toBe("boolean");
    }
  });
});
