import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureManifest } from "../manifest.js";

export function registerGetProjectMapTool(server: McpServer): void {
  server.tool(
    "get_project_map",
    "Lee ghost-manifest.json y devuelve rutas, componentes, formularios y selectores conocidos del proyecto.",
    {
      manifestPath: z.string().min(1).optional(),
      projectRoot: z.string().min(1).optional(),
    },
    async (args) => {
      try {
        const loaded = await ensureManifest({
          manifestPath: args.manifestPath,
          projectRoot: args.projectRoot,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(loaded, null, 2) }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: msg }) }],
          isError: true,
        };
      }
    },
  );
}
