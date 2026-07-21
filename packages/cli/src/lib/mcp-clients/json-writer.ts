import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InjectResult, McpEntry } from "./types.js";

type McpConfig = {
  mcpServers: Record<string, McpEntry>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Escribe/mergea una entrada MCP en un archivo JSON compartido (Cursor, Claude Desktop,
 * el `~/.claude.json` de Claude Code, etc.) sin destruir el resto del contenido.
 * - Config inexistente -> se crea.
 * - Objeto JSON válido SIN `mcpServers` (p. ej. `~/.claude.json` lleno de otras claves)
 *   -> mergeable: se agrega `mcpServers` conservando TODAS las demás claves.
 * - JSON que NO es objeto, o con `mcpServers` de tipo incorrecto -> se respalda a
 *   `<path>.ghostly-backup-<timestamp>` y se ABORTA sin tocar el original.
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
    if (!isPlainObject(parsed)) {
      return backupAndAbort(path, raw);
    }
    const existingServers = parsed.mcpServers;
    if (existingServers !== undefined && !isPlainObject(existingServers)) {
      return backupAndAbort(path, raw);
    }
    // Objeto válido: conservar el resto de las claves, garantizar `mcpServers`.
    config = {
      ...parsed,
      mcpServers: (existingServers as Record<string, McpEntry> | undefined) ?? {},
    };
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
