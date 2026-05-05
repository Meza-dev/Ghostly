import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getCursorMcpPath, getMcpServerEntryPath } from "./paths.js";

type McpServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type McpConfig = {
  mcpServers: Record<string, McpServerEntry>;
};

function readMcpConfig(): McpConfig {
  const path = getCursorMcpPath();
  if (!existsSync(path)) return { mcpServers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as McpConfig;
  } catch {
    return { mcpServers: {} };
  }
}

function writeMcpConfig(config: McpConfig): void {
  const path = getCursorMcpPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
}

export function injectGhostlyMcp(apiKey: string, apiUrl: string): void {
  const config = readMcpConfig();
  const mcpEntry = getMcpServerEntryPath();

  config.mcpServers["ghostly"] = {
    command: process.execPath,
    args: [mcpEntry],
    env: {
      GHOST_API_KEY: apiKey,
      X_API_KEY: apiKey,
      GHOST_API_URL: apiUrl,
    },
  };

  writeMcpConfig(config);
}

export function isMcpAlreadyConfigured(): boolean {
  const config = readMcpConfig();
  return "ghostly" in config.mcpServers;
}
