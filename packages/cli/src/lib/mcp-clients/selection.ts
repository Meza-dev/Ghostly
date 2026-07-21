import type { McpClient } from "./types.js";

export type DetectedClient = { client: McpClient; installed: boolean };

/**
 * Resuelve una lista de ids (de `--mcp-clients` o de la selección del multiselect interactivo)
 * contra el resultado de `detectClients()`. Ids desconocidos o de clientes detect-only
 * (`supported:false`) se descartan con un warning en vez de romper el flujo.
 */
export function resolveSelectedClients(
  detected: DetectedClient[],
  ids: string[],
): { selected: McpClient[]; warnings: string[] } {
  const selected: McpClient[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const match = detected.find((d) => d.client.id === id);
    if (!match) {
      warnings.push(`Unknown MCP client "${raw}" — skipped.`);
      continue;
    }
    if (!match.client.supported) {
      warnings.push(`"${match.client.label}" is not supported yet (coming soon) — skipped.`);
      continue;
    }
    selected.push(match.client);
  }

  return { selected, warnings };
}
