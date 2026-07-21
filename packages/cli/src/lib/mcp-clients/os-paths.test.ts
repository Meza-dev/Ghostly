import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const { execSync } = await import("node:child_process");
const { isBinaryOnPath } = await import("./os-paths.js");

describe("isBinaryOnPath", () => {
  it("returns true when the finder command succeeds", () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    expect(isBinaryOnPath("cursor")).toBe(true);
  });

  it("returns false when the finder command throws (binary not found)", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });
    expect(isBinaryOnPath("nonexistent-binary")).toBe(false);
  });
});
