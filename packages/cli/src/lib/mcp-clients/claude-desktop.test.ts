import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let appData: string;
let localAppData: string;
let macAppSupport: string;

vi.mock("./os-paths.js", () => ({
  appDataDir: () => appData,
  localAppDataDir: () => localAppData,
  macAppSupportDir: () => macAppSupport,
  isBinaryOnPath: () => false,
}));

const { claudeDesktopClient } = await import("./claude-desktop.js");

describe("claudeDesktopClient", () => {
  let dir: string;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-claude-desktop-test-"));
    appData = join(dir, "AppData", "Roaming");
    localAppData = join(dir, "AppData", "Local");
    macAppSupport = join(dir, "Library", "Application Support");
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", { value: platform });
  }

  it("is detect-only: supported is false and inject() is a no-op", () => {
    expect(claudeDesktopClient.supported).toBe(false);
    expect(claudeDesktopClient.inject({ command: "x", args: [], env: {} })).toEqual({
      status: "unsupported",
    });
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
