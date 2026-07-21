import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InjectResult, McpEntry } from "./types.js";

type McpConfig = {
  mcpServers: Record<string, McpEntry>;
};

function isValidMcpConfig(value: unknown): value is McpConfig {
  if (typeof value !== "object" || value === null) return false;
  const servers = (value as Record<string, unknown>).mcpServers;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers);
}

/**
 * Escribe/mergea una entrada MCP en un archivo JSON compartido (Cursor, Claude Desktop, etc.)
 * sin destruir el resto del contenido. Config inexistente -> se crea. Config malformada o sin
 * forma `mcpServers` -> se respalda a `<path>.ghostly-backup-<timestamp>` y se ABORTA sin tocar
 * el original (nunca se sobreescribe silenciosamente).
 */
export function mergeMcpServerIntoJsonFile(path: string, serverKey: string, entry: McpEntry): InjectResult {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let config: McpConfig = { mcpServers: {} };

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return backupAndAbort(path, raw);
    }
    if (!isValidMcpConfig(parsed)) {
      return backupAndAbort(path, raw);
    }
    config = parsed;
  }

  config.mcpServers[serverKey] = entry;

  const tmpPath = `${path}.ghostly-tmp-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf8");
  renameSync(tmpPath, path);

  return { status: "injected" };
}

function backupAndAbort(path: string, raw: string): InjectResult {
  const backupPath = `${path}.ghostly-backup-${Date.now()}`;
  writeFileSync(backupPath, raw, "utf8");
  return {
    status: "skipped-backup",
    detail: `existing config unreadable, backed up to ${backupPath}, not modified`,
  };
}
