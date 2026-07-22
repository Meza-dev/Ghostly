import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerAnalyzeComponentTool } from "./tools/analyze-component.js";
import { registerGetProjectMapTool } from "./tools/get-project-map.js";
import { registerReadFlowDocsTool } from "./tools/read-flow-docs.js";
import { registerListGhostlyProjectsTool } from "./tools/list-ghostly-projects.js";
import { registerSubmitPlanTool } from "./tools/submit-plan.js";
import { registerGetRunTool } from "./tools/get-run.js";

const inputFields = {
  baseUrl: z.string().url(),
  stepsJson: z
    .string()
    .min(2)
    .describe(
      'JSON array of steps: { action, ... }. Actions: goto{url}, click{selector}, fill{selector,value}, press{key}, waitForSelector{selector,timeoutMs?}, snapshot{}, selectOption{selector,value}, check{selector}, uncheck{selector}, setInputFiles{selector,files}, hover{selector}.',
    ),
  headless: z.boolean().optional(),
  captureA11yAfterEachStep: z.boolean().optional(),
  captureScreenshotAfterEachStep: z.boolean().optional(),
  recordVideoOnFailure: z.boolean().optional(),
  artifactsDir: z.string().min(1).optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
};

const server = new McpServer({
  name: "ghostly",
  version: "0.2.7",
});

server.tool(
  "ghostly_run_flow",
  "Runs a test flow in a browser (Playwright) from a base URL and steps.",
  inputFields,
  async (args) => {
    let runFlow: (input: unknown) => Promise<unknown>;
    let runInputSchema: { safeParse: (input: unknown) => any };
    try {
      const runner = await import("@ghostly-io/runner") as {
        runFlow: (input: unknown) => Promise<unknown>;
        runInputSchema: { safeParse: (input: unknown) => any };
      };
      runFlow = runner.runFlow;
      runInputSchema = runner.runInputSchema;
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "Could not load @ghostly-io/runner to execute ghostly_run_flow",
              details: String(error),
            }),
          },
        ],
        isError: true,
      };
    }

    let steps: unknown;
    try {
      steps = JSON.parse(args.stepsJson) as unknown;
    } catch {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "stepsJson is not valid JSON",
            }),
          },
        ],
        isError: true,
      };
    }

    const parsed = runInputSchema.safeParse({
      baseUrl: args.baseUrl,
      steps,
      headless: args.headless,
      captureA11yAfterEachStep: args.captureA11yAfterEachStep,
      captureScreenshotAfterEachStep: args.captureScreenshotAfterEachStep,
      recordVideoOnFailure: args.recordVideoOnFailure,
      artifactsDir: args.artifactsDir,
      defaultTimeoutMs: args.defaultTimeoutMs,
    });

    if (!parsed.success) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ok: false, error: parsed.error.flatten() },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    // Un crash de Playwright (p. ej. browser no instalado) no debe burbujear
    // como excepción del SDK: lo devolvemos como resultado de tool con isError.
    try {
      const result = await runFlow(parsed.data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: msg,
                hint: "If Playwright's browser is missing, run: npx playwright install chromium",
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  },
);

registerGetProjectMapTool(server);
registerAnalyzeComponentTool(server);
registerReadFlowDocsTool(server);
registerSubmitPlanTool(server);
registerListGhostlyProjectsTool(server);
registerGetRunTool(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("[ghostly-mcp]", err);
  process.exit(1);
});
