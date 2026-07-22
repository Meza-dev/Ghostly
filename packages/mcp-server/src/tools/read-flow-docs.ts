import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureManifest } from "../manifest.js";

export function registerReadFlowDocsTool(server: McpServer): void {
  server.tool(
    "read_flow_docs",
    "Reads *.ghost.md documentation for a flow registered in ghost-manifest.json.",
    {
      manifestPath: z.string().min(1).optional(),
      projectRoot: z.string().min(1).optional(),
      flowName: z.string().min(1),
    },
    async (args) => {
      try {
        const { manifest, warning, generated } = await ensureManifest({
          manifestPath: args.manifestPath,
          projectRoot: args.projectRoot,
        });
        const flowName = args.flowName.toLowerCase();
        const flow = manifest.flows.find((item) => item.name.toLowerCase() === flowName);
        if (!flow) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, error: "flow not found", warning, generated }, null, 2),
              },
            ],
          };
        }
        const docPath = path.resolve(manifest.projectRoot, flow.docFile);
        const markdown = await fs.readFile(docPath, "utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, warning, generated, flow, markdown }, null, 2),
            },
          ],
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
