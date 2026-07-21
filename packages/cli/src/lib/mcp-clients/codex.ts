import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isBinaryOnPath } from "./os-paths.js";
import type { InjectResult, McpClient } from "./types.js";

// ponytail: detect-only stub. `codex` binary on PATH, or its known config dir ~/.codex.
export const codexClient: McpClient = {
  id: "codex",
  label: "Codex",
  supported: false,

  detect(): boolean {
    return isBinaryOnPath("codex") || existsSync(resolve(homedir(), ".codex"));
  },

  isConfigured(): boolean {
    return false;
  },

  inject(): InjectResult {
    return { status: "unsupported" };
  },
};
