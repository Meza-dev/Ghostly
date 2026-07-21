import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => false };
});

vi.mock("./os-paths.js", () => ({
  isBinaryOnPath: () => false,
}));

const { antigravityClient } = await import("./antigravity.js");
const { codexClient } = await import("./codex.js");
const { opencodeClient } = await import("./opencode.js");

describe.each([
  ["antigravity", () => antigravityClient],
  ["codex", () => codexClient],
  ["opencode", () => opencodeClient],
])("%s (detect-only stub)", (id, getClient) => {
  it(`has id "${id}", supported:false, and a no-op inject()`, () => {
    const client = getClient();
    expect(client.id).toBe(id);
    expect(client.supported).toBe(false);
    expect(client.inject({ command: "x", args: [], env: {} })).toEqual({ status: "unsupported" });
    expect(client.isConfigured()).toBe(false);
  });

  it("detect() is false when neither binary nor config dir are present", () => {
    expect(getClient().detect()).toBe(false);
  });
});
