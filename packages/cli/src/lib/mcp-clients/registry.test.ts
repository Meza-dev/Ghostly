import { describe, expect, it, vi } from "vitest";

vi.mock("../paths.js", () => ({
  getCursorMcpPath: () => "/nonexistent/mcp.json",
  getCursorRulesAssetsDir: () => "/nonexistent/rules",
  getCursorSkillsAssetsDir: () => "/nonexistent/skills",
}));

const { registry, detectClients } = await import("./registry.js");

describe("registry", () => {
  it("registers the Cursor adapter", () => {
    expect(registry.map((c) => c.id)).toEqual(["cursor"]);
  });

  it("detectClients() resolves adapter + installed flag", () => {
    const result = detectClients();

    expect(result).toHaveLength(1);
    expect(result[0]?.client.id).toBe("cursor");
    expect(result[0]?.installed).toBe(false);
  });
});
