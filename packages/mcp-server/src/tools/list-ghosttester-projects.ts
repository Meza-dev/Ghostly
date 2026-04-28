import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiUrlFromEnv, authHeader } from "../ghost-api.js";

export function registerListGhosttesterProjectsTool(server: McpServer): void {
  server.tool(
    "list_ghosttester_projects",
    "Lista proyectos GhostTester del usuario (GET /v1/projects). Devuelve id, label y color para usar el id en submit_plan como parámetro project.",
    {
      apiUrl: z.string().url().optional(),
      apiKey: z.string().min(1).optional(),
    },
    async (args) => {
      try {
        const response = await fetch(`${apiUrlFromEnv(args.apiUrl)}/v1/projects`, {
          method: "GET",
          headers: {
            ...authHeader(args.apiKey),
          },
        });
        const payload = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload) as unknown;
        } catch {
          parsed = payload;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: response.ok,
                  status: response.status,
                  projects: parsed,
                  hint: response.ok
                    ? "Usa el campo id de un proyecto como parámetro project en submit_plan."
                    : undefined,
                },
                null,
                2,
              ),
            },
          ],
          ...(response.ok ? {} : { isError: true }),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: msg }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
