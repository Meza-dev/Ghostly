import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isBinaryOnPath } from "./os-paths.js";
import type { InjectResult, McpClient } from "./types.js";

// PR2: detect-only. Real inject() (`claude mcp add` + fallback .mcp.json) + skill guidance
// llegan en PR4.
export const claudeCodeClient: McpClient = {
  id: "claude-code",
  label: "Claude Code",
  supported: false,

  detect(): boolean {
    return isBinaryOnPath("claude") || existsSync(resolve(homedir(), ".claude"));
  },

  isConfigured(): boolean {
    return false;
  },

  inject(): InjectResult {
    return { status: "unsupported" };
  },
};
