import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureManifest } from "../manifest.js";

export function registerAnalyzeComponentTool(server: McpServer): void {
  server.tool(
    "analyze_component",
    "Returns selectors, roles and forms associated with a component or file from ghost-manifest.json.",
    {
      manifestPath: z.string().min(1).optional(),
      projectRoot: z.string().min(1).optional(),
      componentName: z.string().min(1).optional(),
      filePath: z.string().min(1).optional(),
    },
    async (args) => {
      try {
      const { manifest, warning, generated } = await ensureManifest({
        manifestPath: args.manifestPath,
        projectRoot: args.projectRoot,
      });
      const componentName = args.componentName?.toLowerCase();
      const filePath = args.filePath?.replace(/\\/g, "/").toLowerCase();
      const components = manifest.components.filter((component) => {
        const matchesName = componentName ? component.name.toLowerCase() === componentName : true;
        const matchesFile = filePath ? component.file.toLowerCase() === filePath : true;
        return matchesName && matchesFile;
      });
      const componentFiles = new Set(components.map((component) => component.file));
      const forms = manifest.forms.filter((form) =>
        componentFiles.has(form.file) || (componentName ? form.name.toLowerCase() === componentName : false),
      );

      return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ warning, generated, components, forms }, null, 2),
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
