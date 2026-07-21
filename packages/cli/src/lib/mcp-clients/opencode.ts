import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isBinaryOnPath } from "./os-paths.js";
import type { InjectResult, McpClient } from "./types.js";

// ponytail: detect-only stub. `opencode` binary on PATH, or its known config dir ~/.config/opencode.
export const opencodeClient: McpClient = {
  id: "opencode",
  label: "OpenCode",
  supported: false,

  detect(): boolean {
    return isBinaryOnPath("opencode") || existsSync(resolve(homedir(), ".config", "opencode"));
  },

  isConfigured(): boolean {
    return false;
  },

  inject(): InjectResult {
    return { status: "unsupported" };
  },
};
