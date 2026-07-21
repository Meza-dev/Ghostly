import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { renderGuidanceWithFrontmatter } from "./guidance-content.js";
import { mergeMcpServerIntoJsonFile } from "./json-writer.js";
import { isBinaryOnPath } from "./os-paths.js";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

function claudeJsonPath(): string {
  return resolve(homedir(), ".claude.json");
}

function isGhostlyConfigured(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const config = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
    return Boolean(config.mcpServers && "ghostly" in config.mcpServers);
  } catch {
    return false;
  }
}

function injectViaCli(entry: McpEntry): boolean {
  try {
    // ponytail: `--scope user` matches the design's assumed default for `claude mcp add`, but is
    // UNVERIFIED against a real Claude Code install — confirm live and adjust the flag if wrong.
    // shell:true (needed to resolve `claude.cmd` on Windows) joins args WITHOUT quoting, so the
    // dynamic parts (node path, script path) are quoted here — the default Windows node lives at
    // `C:\Program Files\nodejs\node.exe` (a space) and would otherwise be split by the shell.
    const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    execFileSync(
      "claude",
      [
        "mcp", "add", "--scope", "user", "--transport", "stdio", "ghostly", "--",
        quote(entry.command),
        ...entry.args.map(quote),
      ],
      { stdio: "ignore", shell: true },
    );
    return true;
  } catch {
    return false;
  }
}

export const claudeCodeClient: McpClient = {
  id: "claude-code",
  label: "Claude Code",
  supported: true,
  restartHint: "Restart or reload Claude Code to pick up the new MCP server.",

  detect(): boolean {
    return isBinaryOnPath("claude") || existsSync(resolve(homedir(), ".claude"));
  },

  isConfigured(): boolean {
    return isGhostlyConfigured(claudeJsonPath());
  },

  inject(entry: McpEntry): InjectResult {
    if (isBinaryOnPath("claude") && injectViaCli(entry)) {
      return { status: "injected" };
    }
    // Fallback: `claude` CLI absent or `claude mcp add` failed — write the config file directly.
    const fallbackEntry = { ...entry, type: "stdio" as const };
    return mergeMcpServerIntoJsonFile(claudeJsonPath(), "ghostly", fallbackEntry);
  },

  installGuidance(): void {
    const skillDir = resolve(homedir(), ".claude", "skills", "ghostly-expert");
    mkdirSync(skillDir, { recursive: true });
    const skill = renderGuidanceWithFrontmatter([
      "name: ghostly-expert",
      "description: Use Ghostly's MCP tools to design and debug robust E2E tests; proactively offer to create a test when the user adds or changes a screen/flow.",
    ]);
    writeFileSync(resolve(skillDir, "SKILL.md"), skill, "utf8");
  },
};
