import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInputSchema } from "@ghosttester/runner";
import { z } from "zod";
import { apiUrlFromEnv, authHeader } from "../ghost-api.js";
import { ensureManifest, stableCodeHints } from "../manifest.js";

export function registerSubmitPlanTool(server: McpServer): void {
  server.tool(
    "submit_plan",
    "Envía un plan enriquecido a POST /v1/run de GhostTester usando el manifest como codeHints opcional. Por defecto activa captura de pantalla tras cada paso (como la UI web). El vídeo solo se guarda si el run falla.",
    {
      apiUrl: z.string().url().optional(),
      apiKey: z.string().min(1).optional(),
      manifestPath: z.string().min(1).optional(),
      projectRoot: z.string().min(1).optional(),
      project: z.string().min(1),
      goal: z.string().min(1),
      contextId: z.string().min(1).optional(),
      baseUrl: z.string().url(),
      stepsJson: z.string().min(2),
      headless: z.boolean().optional(),
      assisted: z.boolean().optional(),
      assistV2: z.boolean().optional(),
      victoryTextIncludes: z.array(z.string().min(1)).max(10).optional(),
      victorySelectorVisible: z.array(z.string().min(1)).max(10).optional(),
      victoryUrlIncludes: z.array(z.string().min(1)).max(10).optional(),
      victoryMustAll: z.boolean().optional(),
      captureScreenshotAfterEachStep: z.boolean().optional(),
      recordVideoOnFailure: z.boolean().optional(),
      captureA11yAfterEachStep: z.boolean().optional(),
      artifactsDir: z.string().min(1).optional(),
      defaultTimeoutMs: z.number().int().positive().optional(),
    },
    async (args) => {
      let steps: unknown;
      try {
        steps = JSON.parse(args.stepsJson) as unknown;
      } catch {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: "stepsJson no es JSON válido" }),
            },
          ],
        };
      }

      const captureScreenshotAfterEachStep = args.captureScreenshotAfterEachStep ?? true;
      const recordVideoOnFailure = args.recordVideoOnFailure ?? true;
      const captureA11yAfterEachStep = args.captureA11yAfterEachStep ?? false;
      const victory = {
        ...(args.victoryTextIncludes && args.victoryTextIncludes.length > 0
          ? { textIncludes: args.victoryTextIncludes }
          : {}),
        ...(args.victorySelectorVisible && args.victorySelectorVisible.length > 0
          ? { selectorVisible: args.victorySelectorVisible }
          : {}),
        ...(args.victoryUrlIncludes && args.victoryUrlIncludes.length > 0
          ? { urlIncludes: args.victoryUrlIncludes }
          : {}),
        ...(args.victoryMustAll !== undefined ? { mustAll: args.victoryMustAll } : {}),
      };
      const hasVictory = Object.keys(victory).length > 0;

      const parsed = runInputSchema.safeParse({
        baseUrl: args.baseUrl,
        steps,
        headless: args.headless,
        captureScreenshotAfterEachStep,
        recordVideoOnFailure,
        captureA11yAfterEachStep,
        ...(args.artifactsDir ? { artifactsDir: args.artifactsDir } : {}),
        ...(args.defaultTimeoutMs ? { defaultTimeoutMs: args.defaultTimeoutMs } : {}),
      });
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: parsed.error.flatten() }, null, 2),
            },
          ],
        };
      }

      let loaded: Awaited<ReturnType<typeof ensureManifest>> | undefined;
      try {
        loaded = await ensureManifest({
          manifestPath: args.manifestPath,
          projectRoot: args.projectRoot,
        });
      } catch {
        loaded = undefined;
      }
      const contextId = args.contextId ?? loaded?.manifest.gitCommit;
      const codeHints = loaded ? stableCodeHints(loaded.manifest) : undefined;
      let response: Response;
      try {
        response = await fetch(`${apiUrlFromEnv(args.apiUrl)}/v1/run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeader(args.apiKey),
          },
          body: JSON.stringify({
            project: args.project,
            ...(contextId ? { contextId } : {}),
            plan: {
              contextId,
              baseUrl: parsed.data.baseUrl,
              steps: parsed.data.steps,
              headless: parsed.data.headless,
              captureA11yAfterEachStep: parsed.data.captureA11yAfterEachStep,
              captureScreenshotAfterEachStep: parsed.data.captureScreenshotAfterEachStep,
              recordVideoOnFailure: parsed.data.recordVideoOnFailure,
              artifactsDir: parsed.data.artifactsDir,
              defaultTimeoutMs: parsed.data.defaultTimeoutMs,
              ...(codeHints ? { codeHints } : {}),
            },
            ...(args.assisted
              ? {
                  assisted: {
                    goal: args.goal,
                    model: "ghosttester-mcp",
                    generatedAt: new Date().toISOString(),
                    promptVersion: "mcp-context-v1",
                  },
                }
              : {}),
            ...(args.assistV2
              ? {
                  assist: {
                    v2: true,
                    goal: args.goal,
                    ...(hasVictory ? { victory } : {}),
                  },
                }
              : {}),
            ...(codeHints ? { codeHints } : {}),
          }),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: msg }) }],
          isError: true,
        };
      }

      const payload = await response.text();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: response.ok,
              status: response.status,
              manifestWarning: loaded?.warning,
              response: payload,
            }, null, 2),
          },
        ],
      };
    },
  );
}
