import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { hasCode, inside, loadTestWorkspace, runTests, type TestWorkspace, type VerifyPlan } from "./test-unit.js";

const tool = "ghostly_test_e2e";
const runIdPlaceholder = "{{runId}}";
const testId = z.string().regex(/^[\w-]+$/).max(100);
const check = z.object({ testId, text: z.string().trim().min(1).max(160) }).strict();
const step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), testId }).strict(),
  z.object({
    action: z.literal("fill"), testId,
    value: z.string().max(160).describe("Synthetic data only. Use {{runId}} in the saved value and the exact same persistence text."),
  }).strict(),
]);
const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];
export const e2eFlow = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64),
  baseUrl: z.string().url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && loopbackHosts.includes(url.hostname) &&
      url.origin === value.replace(/\/$/, "");
  }, "Use a loopback HTTP(S) origin without credentials, path, query or fragment."),
  route: z.string().regex(/^\/(?:[\w-]+(?:\/[\w-]+)*)?$/).max(120),
  steps: z.array(step).min(1).max(12),
  acknowledgement: check.describe("Visible save acknowledgement before reload."),
  persistence: check.describe("Exact visible record text within a stable container after reload."),
}).strict();
const input = { mode: z.enum(["plan", "apply"]).default("plan"), ...e2eFlow.shape };
type E2EInput = z.infer<z.ZodObject<typeof input>>;

export function prepareRunId(args: z.infer<typeof e2eFlow>) {
  const fills = args.steps.flatMap((step) => step.action === "fill" ? [step.value] : []);
  const dynamic = fills.some((value) => value.includes(runIdPlaceholder)) ||
    args.persistence.text.includes(runIdPlaceholder);
  const matches = fills.filter((value) => value === args.persistence.text).length;
  if (args.acknowledgement.text.includes(runIdPlaceholder) || matches !== 1 ||
    (dynamic && !args.persistence.text.includes(runIdPlaceholder))) return {
    ok: false,
    reason: "Use the identical {{runId}} template in exactly one fill value and the persistence text. Keep acknowledgement text fixed.",
  } as const;
  if (dynamic) return { ok: true, flow: args } as const;

  // Upgrade the unambiguous legacy form without changing the request shape.
  const text = `${args.persistence.text} ${runIdPlaceholder}`;
  const steps = args.steps.map((step) =>
    step.action === "fill" && step.value === args.persistence.text ? { ...step, value: text } : step);
  return { ok: true, flow: { ...args, steps, persistence: { ...args.persistence, text } } } as const;
}

function renderTest(args: z.infer<typeof e2eFlow>): string {
  const literal = (value: string) => value.includes(runIdPlaceholder)
    ? `${JSON.stringify(value)}.replaceAll(${JSON.stringify(runIdPlaceholder)}, runId)`
    : JSON.stringify(value);
  const steps = args.steps.map((step) => {
    const locator = `page.getByTestId(${JSON.stringify(step.testId)})`;
    return step.action === "fill"
      ? `    await ${locator}.fill(${literal(step.value)});`
      : `    await ${locator}.click();`;
  });
  const ack = `page.getByTestId(${JSON.stringify(args.acknowledgement.testId)}).filter({ hasText: ${JSON.stringify(args.acknowledgement.text)} })`;
  const persisted = `page.getByTestId(${JSON.stringify(args.persistence.testId)}).getByText(${literal(args.persistence.text)}, { exact: true })`;
  return [
    'import assert from "node:assert/strict";',
    'import { randomUUID } from "node:crypto";',
    'import { test } from "node:test";',
    'import { chromium, errors, type Locator } from "playwright";',
    "",
    "async function assertVisible(locator: Locator, message: string): Promise<void> {",
    '  try { await locator.waitFor({ state: "visible", timeout: 4_000 }); }',
    "  catch (error) {",
    "    if (error instanceof errors.TimeoutError) throw new assert.AssertionError({ message });",
    "    throw error;",
    "  }",
    "}",
    "",
    `test(${JSON.stringify(args.name)}, { timeout: 25_000 }, async () => {`,
    "  const runId = randomUUID();",
    '  const configuredOrigin = process.env.GHOSTLY_E2E_BASE_URL;',
    '  if (!configuredOrigin) throw new Error("Set GHOSTLY_E2E_BASE_URL to the running application origin.");',
    "  const baseUrl = new URL(configuredOrigin);",
    `  if (!${JSON.stringify(loopbackHosts)}.includes(baseUrl.hostname)) throw new Error("Use a loopback application origin.");`,
    '  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.origin !== configuredOrigin.replace(/\\/$/, "")) {',
    '    throw new Error("Use an HTTP(S) origin.");',
    '  }',
    "  const browser = await chromium.launch({ timeout: 10_000 });",
    "  try {",
    "    const page = await browser.newPage();",
    "    page.setDefaultTimeout(5_000);",
    `    await page.goto(new URL(${JSON.stringify(args.route)}, baseUrl).href);`,
    ...steps,
    `    await assertVisible(${ack}, "ACKNOWLEDGEMENT_ASSERTION: save confirmation must be visible before reload.");`,
    "    await page.reload();",
    `    await assertVisible(${persisted}, "PERSISTENCE_ASSERTION: saved record must be visible after reload.");`,
    "  } finally {",
    "    await browser.close();",
    "  }",
    "});",
    "",
  ].join("\n");
}

export function prepareE2ETest(workspace: TestWorkspace, args: z.infer<typeof e2eFlow>) {
  const fileName = `${args.name}.ghostly.e2e.test.ts`;
  const testFile = `${workspace.testDirectory}/${fileName}`;
  return {
    fileName, testFile, generated: renderTest(args),
    command: `node --import tsx --test ${testFile}`,
  };
}

export async function runE2ETest(args: E2EInput, confirmedWorkspace?: TestWorkspace, verifyPlan?: VerifyPlan) {
  const unsupported = (reason: string) => ({ tool, status: "unsupported", reason });
  const preparedFlow = prepareRunId(args);
  if (!preparedFlow.ok) return unsupported(preparedFlow.reason);
  const workspace = confirmedWorkspace ?? await loadTestWorkspace();
  if (!workspace.ok) return unsupported(workspace.reason);
  const { root, directory, manifest, manifestPath } = workspace;
  if (!(manifest.dependencies?.playwright || manifest.devDependencies?.playwright)) {
    return unsupported("Declare Playwright in the target workspace before generating an E2E test.");
  }

  const { fileName, testFile, generated, command } = prepareE2ETest(workspace, preparedFlow.flow);
  const outputFile = path.join(directory, fileName);
  const proposal = {
    tool,
    testFile,
    command,
    environment: { GHOSTLY_E2E_BASE_URL: args.baseUrl },
    assertions: {
      acknowledgement: args.acknowledgement,
      persistenceAfterReload: preparedFlow.flow.persistence,
    },
  };
  if (args.mode === "plan") return { ...proposal, status: "planned", changedFiles: [] };

  try {
    const require = createRequire(manifestPath);
    require.resolve("tsx");
    require.resolve("playwright");
  } catch {
    return unsupported("Install the workspace's declared tsx and Playwright dependencies before applying the plan.");
  }
  if (!inside(root, await realpath(directory))) {
    return unsupported("The configured test directory moved outside the workspace.");
  }
  const existing = await lstat(outputFile).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (existing && (!existing.isFile() || await readFile(outputFile, "utf8") !== generated)) {
    return unsupported(`The target ${testFile} already exists with different content. It was preserved.`);
  }
  const drift = await verifyPlan?.();
  if (drift) return {
    ...proposal, status: "plan_changed", reason: "The workspace changed before generation. Create and confirm a new briefing.",
    drift, changedFiles: [],
  };
  if (!existing) {
    try {
      await writeFile(outputFile, generated, { flag: "wx" });
    } catch (error) {
      if (hasCode(error, "EEXIST")) return unsupported(`The target ${testFile} was created by another operation. Retry to use the existing file.`);
      throw error;
    }
  }
  const verification = await runTests(root, [testFile], proposal.environment);
  return { ...proposal, status: verification.status, verification, changedFiles: existing ? [] : [testFile] };
}

export function registerE2ETestTool(server: McpServer): void {
  server.tool(
    tool,
    "Plan or generate and run a Playwright persistence test against a local application, using stable test IDs and synthetic data.",
    input,
    async (args): Promise<CallToolResult> => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await runE2ETest(args), null, 2) }] };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ tool, status: "error", reason }) }],
          isError: true,
        };
      }
    },
  );
}
