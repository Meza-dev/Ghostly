import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { integrationCaseFromSource } from "./integration-discovery.js";
import { nodeTestReporter, readNodeTestResult } from "./node-test-result.js";
import { candidatesFromSource, modulePattern, readSmallFile, type SupportedCase } from "./unit-discovery.js";

const execFileAsync = promisify(execFile);
const testScriptPattern = /^tsx --test ((?:[\w-]+\/)*[\w-]+)\/\*\.test\.ts$/;
const nativeTestScript = "node --test test/*.test.ts";
const testFilePattern = /^[\w.-]+\.test\.ts$/;

type RunResult = {
  status: "passed" | "failed" | "error" | "no_tests";
  effectiveTests: number;
  durationMs: number;
  output: string;
};

const input = {
  mode: z.enum(["plan", "apply"]).default("plan")
    .describe("Plan inspects only. Apply writes and runs a test in a trusted workspace."),
  module: z.string().optional()
    .describe("Workspace-relative TypeScript module. Omit for repository-wide discovery with ghostly_init."),
};
type TestInput = z.infer<z.ZodObject<typeof input>>;

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function regularFile(root: string, file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile() && inside(root, await realpath(file));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

export async function runTests(
  root: string, files: string[], overrides: Record<string, string> = {}, runner: "tsx" | "native" = "tsx",
): Promise<RunResult> {
  const startedAt = Date.now();
  const loader = runner === "tsx" ? ["--import", "tsx"] : [];
  const args = [...loader, "--test", nodeTestReporter, ...files];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^ghost/i.test(key) && !["NODE_OPTIONS", "NODE_TEST_CONTEXT"].includes(key)),
  );
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: root, env: { ...env, ...overrides }, timeout: 30_000, maxBuffer: 512 * 1024, windowsHide: true,
    });
    return { ...readNodeTestResult(0, stdout, stderr), durationMs: Date.now() - startedAt };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      ...readNodeTestResult(failure.code, failure.stdout ?? "", failure.stderr ?? "", failure.message),
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function loadTestWorkspace(allowSetup = false) {
  const root = await realpath(process.env.GHOST_TARGET_PROJECT_ROOT ?? process.cwd());
  const manifestPath = path.join(root, "package.json");
  if (!await regularFile(root, manifestPath)) {
    return { ok: false, reason: "The MCP workspace must have a package.json file." } as const;
  }
  const manifestText = await readFile(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    return { ok: false, reason: "The workspace package.json must contain valid JSON." } as const;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "The workspace package.json must be a JSON object." } as const;
  }
  const manifest = parsed as {
    scripts?: { test?: string };
    engines?: { node?: string };
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const setup = allowSetup && manifest.scripts?.test === undefined &&
    !["tsx", "vitest", "jest", "mocha", "ava", "tap", "@playwright/test"].some((name) =>
      manifest.devDependencies?.[name] || manifest.dependencies?.[name]);
  const native = manifest.scripts?.test === nativeTestScript || setup;
  const runner = native ? "native" as const : "tsx" as const;
  if (native && !allowSetup && Number(process.versions.node.split(".")[0]) < 24) {
    return { ok: false, reason: "The built-in TypeScript test setup requires Node.js 24 or newer." } as const;
  }
  const testDirectory = native ? "test" : testScriptPattern.exec(manifest.scripts?.test ?? "")?.[1];
  const detected = {
    runtime: "Node.js",
    declaredRunners: ["tsx", "vitest", "jest", "playwright", "@playwright/test"]
      .filter((name) => manifest.devDependencies?.[name] || manifest.dependencies?.[name]),
    testDirectory: testDirectory ?? null,
    hasTestScript: typeof manifest.scripts?.test === "string",
  };
  if (!testDirectory || (!native && !(manifest.devDependencies?.tsx || manifest.dependencies?.tsx))) {
    return { ok: false, detected, reason: "Expected a declared tsx dependency and a test script such as tsx --test test/*.test.ts." } as const;
  }
  const directory = path.join(root, testDirectory);
  const directoryInfo = await lstat(directory).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if ((!setup || directoryInfo) &&
    (!directoryInfo?.isDirectory() || path.relative(directory, await realpath(directory)) !== "")) {
    return { ok: false, detected, reason: "The configured test directory must already exist inside the workspace." } as const;
  }
  return { ok: true, root, manifestPath, manifestText, manifest, testDirectory, directory, runner, setup,
    directoryExists: Boolean(directoryInfo) } as const;
}

export type TestWorkspace = Extract<Awaited<ReturnType<typeof loadTestWorkspace>>, { ok: true }>;
type CodeTestType = "unit" | "integration";
export type CodeCase = SupportedCase & {
  dependency?: { file: string; exportedName: string };
  documentation?: { file: string; line: number };
};
export type VerifyPlan = () => Promise<Array<{ kind: string; files: string[] }> | undefined>;

export async function inspectTestSuite(workspace: TestWorkspace) {
  const entries = workspace.directoryExists ? await readdir(workspace.directory, { withFileTypes: true }) : [];
  const suiteEntries = entries.filter((entry) => entry.name.endsWith(".test.ts"));
  const files = suiteEntries.filter((entry) => entry.isFile() && testFilePattern.test(entry.name))
    .map((entry) => `${workspace.testDirectory}/${entry.name}`).sort();
  return { entries, files, complete: files.length === suiteEntries.length };
}

export function prepareCodeTest(workspace: TestWorkspace, candidate: CodeCase, testType: CodeTestType) {
  const { functionName, behavior, assertion } = candidate;
  const module = candidate.evidence.file;
  const relativeImport = path.relative(workspace.directory, path.join(workspace.root, module)).split(path.sep).join("/");
  const importPath = relativeImport.startsWith("../") ? relativeImport : `./${relativeImport}`;
  const suffix = testType === "integration" ? ".ghostly.integration.test.ts" : ".ghostly.test.ts";
  const fileName = `${path.basename(module, ".ts")}${suffix}`;
  const testFile = `${workspace.testDirectory}/${fileName}`;
  const generated = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { ${functionName} } from ${JSON.stringify(importPath)};`,
    "",
    `test(${JSON.stringify(behavior)}, () => {`,
    `  ${assertion};`,
    "});",
    "",
  ].join("\n");
  return { fileName, generated, testFile, command: replayCommand(workspace, testFile) };
}

export function replayCommand(workspace: TestWorkspace, file: string): string {
  return workspace.runner === "native" ? `node --test ${file}` : `node --import tsx --test ${file}`;
}

export function runnerReady(workspace: TestWorkspace): boolean {
  return workspace.runner === "native"
    ? Number(process.versions.node.split(".")[0]) >= 24
    : dependencyInstalled(workspace, "tsx");
}

export function dependencyInstalled(workspace: TestWorkspace, dependency: string): boolean {
  try {
    createRequire(workspace.manifestPath).resolve(dependency);
    return true;
  } catch {
    return false;
  }
}

export async function runCodeTest(
  tool: string, mode: TestInput["mode"], workspace: TestWorkspace,
  suite: Awaited<ReturnType<typeof inspectTestSuite>>, candidate: CodeCase, testType: CodeTestType,
  startedAt = Date.now(), verifyPlan?: VerifyPlan, priorBaseline?: Awaited<ReturnType<typeof runBaseline>>,
  deferExecution = false,
) {
  const unsupported = (reason: string) => ({ tool, status: "unsupported", reason });
  const { root, directory } = workspace;
  const { fileName, testFile, command, generated } = prepareCodeTest(workspace, candidate, testType);
  const outputFile = path.join(directory, fileName);
  const proposal = {
    tool,
    roles: { analysis: workspace.runner === "native" ? "Node.js native TypeScript + node:test" : "tsx + node:test", planning: "Independent expectation documented in source" },
    case: candidate,
    testFile,
    command,
  };
  if (mode === "plan") {
    return { ...proposal, status: "planned", changedFiles: [], durationMs: Date.now() - startedAt };
  }

  if (!runnerReady(workspace)) {
    return unsupported("Install the project's declared tsx dependency before applying the plan.");
  }
  const priorFile = suite.entries.find((entry) => entry.name.toLowerCase() === fileName.toLowerCase());
  if (priorFile && (!priorFile.isFile() || priorFile.name !== fileName ||
    await readFile(outputFile, "utf8") !== generated)) {
    return unsupported(`The target ${testFile} already exists with different content. It was preserved.`);
  }
  const baseline = priorBaseline ?? await runBaseline(workspace, suite, testFile);

  if (!verifyPlan && !inside(root, await realpath(directory))) {
    return unsupported("The test directory moved outside the workspace during the baseline.");
  }
  const drift = await verifyPlan?.();
  if (drift) return {
    ...proposal, status: "plan_changed", reason: "The workspace changed before generation. Create and confirm a new briefing.",
    drift, baseline, changedFiles: [],
  };
  if (!priorFile) {
    try {
      await writeFile(outputFile, generated, { flag: "wx" });
    } catch (error) {
      if (hasCode(error, "EEXIST")) return unsupported(`The target ${testFile} was created by another operation. Retry to use the existing file.`);
      throw error;
    }
  }
  const verification = deferExecution ? undefined : await runTests(root, [testFile], {}, workspace.runner);
  return {
    ...proposal,
    status: verification?.status ?? "generated",
    durationMs: Date.now() - startedAt,
    changedFiles: priorFile ? [] : [testFile],
    roles: {
      ...proposal.roles,
      generation: priorFile ? "Reused unchanged test" : "Created Node test",
      verification: "Ran the baseline and generated test separately",
    },
    baseline,
    verification,
  };
}

export async function runBaseline(
  workspace: TestWorkspace, suite: Awaited<ReturnType<typeof inspectTestSuite>>, exclude?: string,
) {
  const files = suite.files.filter((file) => file !== exclude);
  if (!suite.complete) return { status: "unavailable", reason: "The suite contains test entries outside the supported file convention." } as const;
  return files.length ? runTests(workspace.root, files, {}, workspace.runner) : { status: "empty" } as const;
}

export async function testWorkflow(tool: string, args: TestInput) {
  const startedAt = Date.now();
  const integration = tool === "ghostly_test_integration";
  const unsupported = (reason: string) => ({ tool, status: "unsupported", reason });
  const module = args.module;
  if (!module || !modulePattern.test(module)) {
    return unsupported("Provide a workspace-relative TypeScript module such as src/discount.ts.");
  }
  const workspace = await loadTestWorkspace();
  if (!workspace.ok) return unsupported(workspace.reason);
  const { root } = workspace;
  if (!await regularFile(root, path.join(root, module))) {
    return unsupported("The module must be a regular TypeScript file inside the workspace.");
  }
  const source = await readSmallFile(root, module);
  const integrationCase = integration && source ? integrationCaseFromSource(module, source) : undefined;
  if (integration && (!integrationCase ||
    !await regularFile(root, path.join(root, integrationCase.dependency.file)))) {
    return unsupported("Expected an @integrationExample and a direct named call to a separate relative TypeScript module inside the workspace.");
  }
  const candidate = integrationCase ?? (source && candidatesFromSource(module, source)
    .find((item) => item.assertion !== null));
  if (!candidate || candidate.assertion === null) {
    return unsupported("Expected a numeric @example or an explicitly documented inclusive boolean boundary on an exported function.");
  }
  const suite = await inspectTestSuite(workspace);
  return runCodeTest(tool, args.mode, workspace, suite, candidate, integration ? "integration" : "unit", startedAt);
}

export function registerTestWorkflowTools(server: McpServer): void {
  for (const [name, description] of [
    ["ghostly_test_unit", "Plan or apply a unit test from an independent written expectation in a TypeScript module."],
    ["ghostly_test_integration", "Plan or apply a TypeScript integration test for a documented operation and its direct local module dependency."],
  ] as const) {
    const fields = name === "ghostly_test_integration" ? {
      ...input, module: z.string().describe("Workspace-relative TypeScript module."),
    } : input;
    server.tool(name, description, fields, async (args: TestInput): Promise<CallToolResult> => {
      try {
        const result = await testWorkflow(name, args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ tool: name, status: "error", reason }) }],
          isError: true,
        };
      }
    });
  }
}
