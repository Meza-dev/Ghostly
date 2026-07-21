import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { getCursorMcpPath, getCursorRulesAssetsDir, getCursorSkillsAssetsDir } from "../paths.js";
import { mergeMcpServerIntoJsonFile } from "./json-writer.js";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

function copyCursorAssetsGlobal(): { copied: number; skipped: boolean } {
  const rulesSrc = getCursorRulesAssetsDir();
  const skillsSrc = getCursorSkillsAssetsDir();
  if (!existsSync(rulesSrc) && !existsSync(skillsSrc)) {
    return { copied: 0, skipped: true };
  }

  const cursorDir = resolve(homedir(), ".cursor");
  const rulesDest = resolve(cursorDir, "rules");
  const skillsDest = resolve(cursorDir, "skills");
  mkdirSync(rulesDest, { recursive: true });
  mkdirSync(skillsDest, { recursive: true });

  let copied = 0;
  const ruleFile = resolve(rulesDest, "ghosttester-expert-architect.mdc");
  const skillDir = resolve(skillsDest, "ghosttester-expert-architect");

  if (existsSync(rulesSrc) && !existsSync(ruleFile)) {
    cpSync(rulesSrc, rulesDest, { recursive: true });
    copied += 1;
  }
  if (existsSync(skillsSrc) && !existsSync(skillDir)) {
    cpSync(skillsSrc, skillsDest, { recursive: true });
    copied += 1;
  }
  return { copied, skipped: false };
}

export const cursorClient: McpClient = {
  id: "cursor",
  label: "Cursor",
  supported: true,

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
    const s = p.spinner();
    s.start("Syncing rules and skills into ~/.cursor/");
    try {
      const result = copyCursorAssetsGlobal();
      if (result.skipped) {
        s.stop("No Cursor assets found in this build");
        p.log.warn("Reinstall/update the CLI to include the bundled rules and skills.");
      } else if (result.copied === 0) {
        s.stop("Global rules and skills were already present ✓");
      } else {
        s.stop(`Global rules and skills copied ✓ (${result.copied} blocks)`);
      }
    } catch (err) {
      s.stop("Could not import rules/skills");
      p.log.error(String(err));
    }
  },
};
