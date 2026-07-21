import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpEntry } from "./types.js";

let appData: string;
let localAppData: string;
let macAppSupport: string;
let homeDir: string;

vi.mock("./os-paths.js", () => ({
  appDataDir: () => appData,
  localAppDataDir: () => localAppData,
  macAppSupportDir: () => macAppSupport,
  isBinaryOnPath: () => false,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => homeDir };
});

vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { claudeDesktopClient } = await import("./claude-desktop.js");

const entry: McpEntry = {
  command: "node",
  args: ["/abs/index.js"],
  env: { GHOST_API_KEY: "k", GHOST_API_URL: "u" },
};

describe("claudeDesktopClient", () => {
  let dir: string;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-claude-desktop-test-"));
    appData = join(dir, "AppData", "Roaming");
    localAppData = join(dir, "AppData", "Local");
    macAppSupport = join(dir, "Library", "Application Support");
    homeDir = join(dir, "home");
    mkdirSync(homeDir, { recursive: true });
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    setPlatform("win32");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", { value: platform });
  }

  it("is supported and injectable", () => {
    expect(claudeDesktopClient.supported).toBe(true);
  });

  it("inject() writes the ghostly entry while preserving other servers", () => {
    const configPath = join(appData, "Claude", "claude_desktop_config.json");
    mkdirSync(join(appData, "Claude"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcpServers: { other: { command: "y", args: [] } } }));

    const result = claudeDesktopClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
    expect(written.mcpServers.other).toEqual({ command: "y", args: [] });
  });

  it("inject() writes to the default %APPDATA% path when no config exists yet", () => {
    const result = claudeDesktopClient.inject(entry);

    expect(result.status).toBe("injected");
    const written = JSON.parse(readFileSync(join(appData, "Claude", "claude_desktop_config.json"), "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
  });

  it("inject() backs up and aborts on a malformed existing config", () => {
    const configPath = join(appData, "Claude", "claude_desktop_config.json");
    mkdirSync(join(appData, "Claude"), { recursive: true });
    writeFileSync(configPath, "{not json");

    const result = claudeDesktopClient.inject(entry);

    expect(result.status).toBe("skipped-backup");
    expect(readFileSync(configPath, "utf8")).toBe("{not json");
  });

  it("isConfigured() flips from false to true after inject()", () => {
    expect(claudeDesktopClient.isConfigured()).toBe(false);
    claudeDesktopClient.inject(entry);
    expect(claudeDesktopClient.isConfigured()).toBe(true);
  });

  it("inject() prefers the MSIX path when that's the one that already exists", () => {
    const msixDir = join(localAppData, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
    mkdirSync(msixDir, { recursive: true });
    writeFileSync(join(msixDir, "claude_desktop_config.json"), JSON.stringify({ mcpServers: {} }));

    claudeDesktopClient.inject(entry);

    const written = JSON.parse(readFileSync(join(msixDir, "claude_desktop_config.json"), "utf8"));
    expect(written.mcpServers.ghostly).toEqual(entry);
    expect(() => readFileSync(join(appData, "Claude", "claude_desktop_config.json"), "utf8")).toThrow();
  });

  it("installGuidance() writes a paste-able snippet with the key guidance markers", () => {
    claudeDesktopClient.installGuidance?.();

    const written = readFileSync(join(homeDir, ".ghostly", "claude-desktop-guidance.md"), "utf8");
    expect(written).toContain("get_project_map");
    expect(written).toContain("ghostly_run_flow");
    expect(written).toContain("submit_plan");
    expect(written.toLowerCase()).toContain("proactiv");
  });

  it("detect() is false on windows when neither APPDATA nor the MSIX path exists", () => {
    setPlatform("win32");
    expect(claudeDesktopClient.detect()).toBe(false);
  });

  it("detect() is true on windows when the APPDATA config exists", () => {
    setPlatform("win32");
    mkdirSync(join(appData, "Claude"), { recursive: true });
    writeFileSync(join(appData, "Claude", "claude_desktop_config.json"), "{}");
    expect(claudeDesktopClient.detect()).toBe(true);
  });

  it("detect() falls back to the MSIX LocalAppData path when APPDATA config is absent", () => {
    setPlatform("win32");
    const msixDir = join(
      localAppData,
      "Packages",
      "Claude_pzs8sxrjxfjjc",
      "LocalCache",
      "Roaming",
      "Claude",
    );
    mkdirSync(msixDir, { recursive: true });
    writeFileSync(join(msixDir, "claude_desktop_config.json"), "{}");
    expect(claudeDesktopClient.detect()).toBe(true);
  });

  it("detect() is true on macOS when the Application Support config exists", () => {
    setPlatform("darwin");
    mkdirSync(join(macAppSupport, "Claude"), { recursive: true });
    writeFileSync(join(macAppSupport, "Claude", "claude_desktop_config.json"), "{}");
    expect(claudeDesktopClient.detect()).toBe(true);
  });
});
