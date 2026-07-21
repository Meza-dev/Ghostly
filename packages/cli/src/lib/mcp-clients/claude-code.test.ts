import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpEntry } from "./types.js";

let claudeHomeDir: string;
let binaryOnPath = false;
let execFileSyncImpl: (...args: unknown[]) => unknown = () => undefined;

vi.mock("./os-paths.js", () => ({
  isBinaryOnPath: () => binaryOnPath,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => claudeHomeDir };
});

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncImpl(...args),
}));

const { claudeCodeClient } = await import("./claude-code.js");

const entry: McpEntry = {
  command: "node",
  args: ["/abs/index.js"],
  env: { GHOST_API_KEY: "k", GHOST_API_URL: "u" },
};

function claudeJsonPath(): string {
  return join(claudeHomeDir, ".claude.json");
}

describe("claudeCodeClient", () => {
  let dir: string;

  beforeEach(() => {
    binaryOnPath = false;
    execFileSyncImpl = () => undefined;
    dir = mkdtempSync(join(tmpdir(), "ghostly-claude-code-test-"));
    claudeHomeDir = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is supported", () => {
    expect(claudeCodeClient.supported).toBe(true);
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

  it("inject() shells out to `claude mcp add` when the CLI is on PATH", () => {
    binaryOnPath = true;
    let calledArgv: unknown[] = [];
    execFileSyncImpl = (...args: unknown[]) => {
      calledArgv = args;
      return "";
    };

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("injected");
    expect(calledArgv[0]).toBe("claude");
    expect(calledArgv[1]).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "stdio",
      "ghostly",
      "--",
      '"node"',
      '"/abs/index.js"',
    ]);
  });

  it("inject() falls back to writing .claude.json when the CLI is absent", () => {
    binaryOnPath = false;

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(claudeJsonPath(), "utf8"));
    expect(written.mcpServers.ghostly).toMatchObject({ ...entry, type: "stdio" });
  });

  it("inject() falls back to writing .claude.json when `claude mcp add` fails", () => {
    binaryOnPath = true;
    execFileSyncImpl = () => {
      throw new Error("claude: command failed");
    };

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(claudeJsonPath(), "utf8"));
    expect(written.mcpServers.ghostly).toMatchObject({ ...entry, type: "stdio" });
  });

  it("fallback adds ghostly to a real ~/.claude.json that has no mcpServers yet", () => {
    // El footgun: ~/.claude.json es el config grande de Claude Code (projects, settings)
    // que suele NO tener mcpServers hasta el primer server. Debe mergear, no abortar.
    writeFileSync(claudeJsonPath(), JSON.stringify({ projects: { p: 1 }, numStartups: 42 }));

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(claudeJsonPath(), "utf8"));
    expect(written.projects).toEqual({ p: 1 });
    expect(written.numStartups).toBe(42);
    expect(written.mcpServers.ghostly).toMatchObject({ ...entry, type: "stdio" });
  });

  it("fallback preserves existing keys and other servers in ~/.claude.json", () => {
    writeFileSync(
      claudeJsonPath(),
      JSON.stringify({ projects: { p: 1 }, mcpServers: { other: { command: "x", args: [] } } }),
    );

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(claudeJsonPath(), "utf8"));
    expect(written.projects).toEqual({ p: 1 });
    expect(written.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(written.mcpServers.ghostly).toMatchObject({ ...entry, type: "stdio" });
  });

  it("fallback backs up and aborts a truly malformed .claude.json", () => {
    writeFileSync(claudeJsonPath(), "{not json");

    const result = claudeCodeClient.inject(entry);

    expect(result.status).toBe("skipped-backup");
    expect(readFileSync(claudeJsonPath(), "utf8")).toBe("{not json");
  });

  it("isConfigured() flips from false to true after a fallback inject()", () => {
    expect(claudeCodeClient.isConfigured()).toBe(false);
    claudeCodeClient.inject(entry);
    expect(claudeCodeClient.isConfigured()).toBe(true);
  });

  it("installGuidance() writes a SKILL.md with valid frontmatter and the guidance body", () => {
    claudeCodeClient.installGuidance?.();

    const written = readFileSync(
      join(claudeHomeDir, ".claude", "skills", "ghostly-expert", "SKILL.md"),
      "utf8",
    );
    expect(written).toContain("name: ghostly-expert");
    expect(written).toContain("description:");
    expect(written).toContain("get_project_map");
    expect(written).toContain("ghostly_run_flow");
    expect(written).toContain("submit_plan");
  });
});
