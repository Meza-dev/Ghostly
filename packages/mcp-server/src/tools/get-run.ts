import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiUrlFromEnv, authHeader } from "../ghost-api.js";

// Proyección compacta del run: el payload completo incluye steps con a11y y
// events (muy pesados para contexto de agente); el detalle vive en el dashboard.
type RunPayload = {
  id?: string;
  status?: string;
  verdict?: string;
  verdictReason?: string;
  stopReason?: string;
  baseUrl?: string;
  project?: string;
  startedAt?: string;
  durationMs?: number;
  videoPath?: string;
  assisted?: { goal?: string };
  steps?: Array<{ index: number; action: string; ok: boolean; error?: string; screenshotPath?: string }>;
};

function projectRun(run: RunPayload): Record<string, unknown> {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const failed = steps.filter((s) => !s.ok);
  return {
    id: run.id,
    status: run.status,
    verdict: run.verdict,
    verdictReason: run.verdictReason,
    stopReason: run.stopReason,
    goal: run.assisted?.goal,
    project: run.project,
    baseUrl: run.baseUrl,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    stepsTotal: steps.length,
    stepsOk: steps.length - failed.length,
    stepsFailed: failed.length,
    failedSteps: failed.map((s) => ({
      index: s.index,
      action: s.action,
      error: s.error,
      ...(s.screenshotPath ? { screenshotPath: s.screenshotPath } : {}),
    })),
    ...(run.videoPath ? { videoPath: run.videoPath } : {}),
  };
}

export function registerGetRunTool(server: McpServer): void {
  server.tool(
    "get_run",
    "Gets a Ghostly run by id: status, verdict and steps. Use it after submit_plan to check the result (poll while status is running).",
    {
      runId: z.string().min(1),
      apiUrl: z.string().url().optional(),
      apiKey: z.string().min(1).optional(),
    },
    async (args) => {
      try {
        const response = await fetch(
          `${apiUrlFromEnv(args.apiUrl)}/v1/runs/${encodeURIComponent(args.runId)}`,
          {
            method: "GET",
            headers: {
              ...authHeader(args.apiKey),
            },
          },
        );
        const payload = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload) as unknown;
        } catch {
          parsed = payload;
        }
        const run =
          response.ok && parsed && typeof parsed === "object"
            ? projectRun(parsed as RunPayload)
            : parsed;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: response.ok,
                  status: response.status,
                  run,
                  hint: response.ok
                    ? "Compact projection — full step detail, events and artifacts are in the Ghostly dashboard."
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
