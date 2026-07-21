import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { getCursorMcpPath } from "../paths.js";
import { renderGuidanceWithFrontmatter } from "./guidance-content.js";
import { mergeMcpServerIntoJsonFile } from "./json-writer.js";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

function cursorRulePath(): string {
  return resolve(homedir(), ".cursor", "rules", "ghostly-expert.mdc");
}

export const cursorClient: McpClient = {
  id: "cursor",
  label: "Cursor",
  supported: true,
  restartHint: "Restart or reload Cursor to pick up the new MCP server.",

  detect(): boolean {
    return existsSync(getCursorMcpPath());
  },

  isConfigured(): boolean {
    const path = getCursorMcpPath();
    if (!existsSync(path)) return false;
    try {
      const config = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
      return Boolean(config.mcpServers && "ghostly" in config.mcpServers);
    } catch {
      return false;
    }
  },

  inject(entry: McpEntry): InjectResult {
    return mergeMcpServerIntoJsonFile(getCursorMcpPath(), "ghostly", entry);
  },

  installGuidance(): void {
    try {
      const rulePath = cursorRulePath();
      mkdirSync(resolve(homedir(), ".cursor", "rules"), { recursive: true });
      const rule = renderGuidanceWithFrontmatter([
        "description: Activa el protocolo Ghostly Expert para diseño y depuración de tests E2E robustos.",
        "alwaysApply: true",
      ]);
      writeFileSync(rulePath, rule, "utf8");
      p.log.info(`Ghostly Expert rule written to ${rulePath} ✓`);
    } catch (err) {
      p.log.warn(`Could not write the Cursor rule: ${String(err)}`);
    }
  },
};
