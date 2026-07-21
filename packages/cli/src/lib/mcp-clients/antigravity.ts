import { isBinaryOnPath } from "./os-paths.js";
import type { InjectResult, McpClient } from "./types.js";

// ponytail: detect-only stub, binary-on-PATH check only — no config-dir convention is
// documented for Antigravity yet. Real adapter (if it ships) lands in a later PR.
export const antigravityClient: McpClient = {
  id: "antigravity",
  label: "Antigravity",
  supported: false,

  detect(): boolean {
    return isBinaryOnPath("antigravity");
  },

  isConfigured(): boolean {
    return false;
  },

  inject(): InjectResult {
    return { status: "unsupported" };
  },
};
