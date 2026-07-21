import { getMcpServerEntryPath } from "../paths.js";
import type { McpEntry } from "./types.js";

/** Entry client-agnostic: execPath del CLI + ruta absoluta al mcp-server + env. */
export function buildMcpEntry(apiKey: string, apiUrl: string): McpEntry {
  return {
    command: process.execPath,
    args: [getMcpServerEntryPath()],
    env: {
      GHOST_API_KEY: apiKey,
      GHOST_API_URL: apiUrl,
    },
  };
}
