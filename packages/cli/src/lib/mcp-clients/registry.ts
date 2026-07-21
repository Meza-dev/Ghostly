import { cursorClient } from "./cursor.js";
import type { McpClient } from "./types.js";

/** Fuente de verdad única para install.ts y `ghostly mcp`. */
export const registry: McpClient[] = [cursorClient];

export function detectClients(): { client: McpClient; installed: boolean }[] {
  return registry.map((client) => ({ client, installed: client.detect() }));
}
