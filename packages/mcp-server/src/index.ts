import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runFlow, runInputSchema } from "@ghosttester/runner";

const inputFields = {
  baseUrl: z.string().url(),
  stepsJson: z
    .string()
    .min(2)
    .describe("JSON array of steps with { action, ... }"),
  headless: z.boolean().optional(),
  captureA11yAfterEachStep: z.boolean().optional(),
  captureScreenshotAfterEachStep: z.boolean().optional(),
  recordVideoOnFailure: z.boolean().optional(),
  artifactsDir: z.string().min(1).optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
};

const server = new McpServer({
  name: "ghosttester",
  version: "0.0.0",
});

server.tool(
  "ghosttester_run_flow",
  "Ejecuta un flujo de prueba en un navegador (Playwright) a partir de una URL base y pasos.",
  inputFields,
  async (args) => {
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
              error: "stepsJson no es JSON válido",
            }),
          },
        ],
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
      };
    }

    const result = await runFlow(parsed.data);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(() => process.exit(1));
