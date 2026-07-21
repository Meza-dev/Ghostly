import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let claudeHomeDir: string;
let binaryOnPath = false;

vi.mock("./os-paths.js", () => ({
  isBinaryOnPath: () => binaryOnPath,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => claudeHomeDir };
});

const { claudeCodeClient } = await import("./claude-code.js");

describe("claudeCodeClient", () => {
  let dir: string;

  beforeEach(() => {
    binaryOnPath = false;
    dir = mkdtempSync(join(tmpdir(), "ghostly-claude-code-test-"));
    claudeHomeDir = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is detect-only: supported is false and inject() is a no-op", () => {
    expect(claudeCodeClient.supported).toBe(false);
    expect(claudeCodeClient.inject({ command: "x", args: [], env: {} })).toEqual({
      status: "unsupported",
    });
  });

  it("detect() is false when neither the claude binary nor ~/.claude exist", () => {
    expect(claudeCodeClient.detect()).toBe(false);
  });

  it("detect() is true when the claude binary is on PATH", () => {
    binaryOnPath = true;
    expect(claudeCodeClient.detect()).toBe(true);
  });

  it("detect() is true when ~/.claude exists even without the binary", () => {
    mkdirSync(join(claudeHomeDir, ".claude"), { recursive: true });
    expect(claudeCodeClient.detect()).toBe(true);
  });
});

void homedir; // keep the mocked import referenced for type-checking
