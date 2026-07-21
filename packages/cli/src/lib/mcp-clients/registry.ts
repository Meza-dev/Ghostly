import { antigravityClient } from "./antigravity.js";
import { claudeCodeClient } from "./claude-code.js";
import { claudeDesktopClient } from "./claude-desktop.js";
import { codexClient } from "./codex.js";
import { cursorClient } from "./cursor.js";
import { opencodeClient } from "./opencode.js";
import type { McpClient } from "./types.js";

/** Fuente de verdad única para install.ts y `ghostly mcp`. */
export const registry: McpClient[] = [
  cursorClient,
  claudeDesktopClient,
  claudeCodeClient,
  antigravityClient,
  codexClient,
  opencodeClient,
];

export function detectClients(): { client: McpClient; installed: boolean }[] {
  return registry.map((client) => ({ client, installed: client.detect() }));
}
