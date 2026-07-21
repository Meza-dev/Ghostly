import { describe, expect, it } from "vitest";
import { buildMcpEntry } from "./entry.js";

describe("buildMcpEntry", () => {
  it("builds a client-agnostic entry with GHOST env vars and no X_API_KEY", () => {
    const entry = buildMcpEntry("secret-key", "http://localhost:4000");

    expect(entry.command).toBe(process.execPath);
    expect(entry.args).toHaveLength(1);
    expect(entry.args[0]).toMatch(/mcp-server/);
    expect(entry.env).toEqual({ GHOST_API_KEY: "secret-key", GHOST_API_URL: "http://localhost:4000" });
    expect(entry.env.X_API_KEY).toBeUndefined();
  });
});
