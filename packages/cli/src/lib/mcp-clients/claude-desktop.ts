import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { appDataDir, localAppDataDir, macAppSupportDir } from "./os-paths.js";
import type { InjectResult, McpClient } from "./types.js";

// ponytail: id de paquete MSIX específico de versión (ver design). detect() tolera su ausencia
// y cae a %APPDATA% — no rompe si Anthropic cambia el id en una futura versión de Desktop.
const MSIX_PACKAGE_ID = "Claude_pzs8sxrjxfjjc";

function candidatePaths(): string[] {
  if (process.platform === "win32") {
    const paths = [resolve(appDataDir(), "Claude", "claude_desktop_config.json")];
    paths.push(
      resolve(
        localAppDataDir(),
        "Packages",
        MSIX_PACKAGE_ID,
        "LocalCache",
        "Roaming",
        "Claude",
        "claude_desktop_config.json",
      ),
    );
    return paths;
  }
  if (process.platform === "darwin") {
    return [resolve(macAppSupportDir(), "Claude", "claude_desktop_config.json")];
  }
  return [resolve(homedir(), ".config", "Claude", "claude_desktop_config.json")];
}

// PR2: detect-only. Real inject()/isConfigured() (JSON writer + guidance snippet) llegan en PR3.
export const claudeDesktopClient: McpClient = {
  id: "claude-desktop",
  label: "Claude Desktop",
  supported: false,

  detect(): boolean {
    return candidatePaths().some((path) => existsSync(path));
  },

  isConfigured(): boolean {
    return false;
  },

  inject(): InjectResult {
    return { status: "unsupported" };
  },
};
