import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { GHOSTLY_GUIDANCE_MARKDOWN } from "./guidance-content.js";
import { mergeMcpServerIntoJsonFile } from "./json-writer.js";
import { appDataDir, localAppDataDir, macAppSupportDir } from "./os-paths.js";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

// ponytail: id de paquete MSIX específico de versión (ver design). detect()/resolvedConfigPath()
// toleran su ausencia y caen a %APPDATA% — no rompe si Anthropic cambia el id en una futura versión.
const MSIX_PACKAGE_ID = "Claude_pzs8sxrjxfjjc";

function candidatePaths(): string[] {
  if (process.platform === "win32") {
    return [
      resolve(appDataDir(), "Claude", "claude_desktop_config.json"),
      resolve(
        localAppDataDir(),
        "Packages",
        MSIX_PACKAGE_ID,
        "LocalCache",
        "Roaming",
        "Claude",
        "claude_desktop_config.json",
      ),
    ];
  }
  if (process.platform === "darwin") {
    return [resolve(macAppSupportDir(), "Claude", "claude_desktop_config.json")];
  }
  return [resolve(homedir(), ".config", "Claude", "claude_desktop_config.json")];
}

/** La primera ruta candidata que ya existe; si ninguna existe, la default (para crear). */
function resolvedConfigPath(): string {
  return candidatePaths().find((path) => existsSync(path)) ?? candidatePaths()[0]!;
}

function guidancePath(): string {
  return resolve(homedir(), ".ghostly", "claude-desktop-guidance.md");
}

export const claudeDesktopClient: McpClient = {
  id: "claude-desktop",
  label: "Claude Desktop",
  supported: true,
  restartHint:
    "Fully quit Claude Desktop from the system tray (not just close the window) to load Ghostly.",

  detect(): boolean {
    return candidatePaths().some((path) => existsSync(path));
  },

  isConfigured(): boolean {
    const path = resolvedConfigPath();
    if (!existsSync(path)) return false;
    try {
      const config = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
      return Boolean(config.mcpServers && "ghostly" in config.mcpServers);
    } catch {
      return false;
    }
  },

  inject(entry: McpEntry): InjectResult {
    return mergeMcpServerIntoJsonFile(resolvedConfigPath(), "ghostly", entry);
  },

  installGuidance(): void {
    try {
      mkdirSync(resolve(homedir(), ".ghostly"), { recursive: true });
      writeFileSync(guidancePath(), GHOSTLY_GUIDANCE_MARKDOWN, "utf8");
      p.note(GHOSTLY_GUIDANCE_MARKDOWN, "Paste into Claude Desktop's custom instructions");
      p.log.info(`Snippet also saved to ${guidancePath()}`);
    } catch (err) {
      p.log.warn(`Could not write the guidance snippet: ${String(err)}`);
    }
  },
};
