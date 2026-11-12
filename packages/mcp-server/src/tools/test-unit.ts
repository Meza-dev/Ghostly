import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { integrationCaseFromSource } from "./integration-discovery.js";
import { candidatesFromSource, discoverUnitCandidates, modulePattern, readSmallFile } from "./unit-discovery.js";

const execFileAsync = promisify(execFile);
const testScriptPattern = /^tsx --test ((?:[\w-]+\/)*[\w-]+)\/\*\.test\.ts$/;
const testFilePattern = /^[\w.-]+\.test\.ts$/;

type RunResult = {
  status: "passed" | "failed" | "error";
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

async function regularFile(root: string, file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile() && inside(root, await realpath(file));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

export async function runTests(
  root: string, files: string[], overrides: Record<string, string> = {},
): Promise<RunResult> {
  const startedAt = Date.now();
  const args = ["--import", "tsx", "--test", ...files];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^ghost/i.test(key) && key !== "NODE_OPTIONS"),
  );
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: root, env: { ...env, ...overrides }, timeout: 30_000, maxBuffer: 512 * 1024, windowsHide: true,
    });
    return { status: "passed", durationMs: Date.now() - startedAt, output: stdout };
  } catch (error) {
    const failure = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.code === 1 && /^not ok /m.test(failure.stdout ?? "") ? "failed" : "error",
      durationMs: Date.now() - startedAt,
      output: [failure.stdout, failure.stderr].filter(Boolean).join("\n") || failure.message,
    };
  }
}

export async function loadTestWorkspace() {
  const root = await realpath(process.env.GHOST_TARGET_PROJECT_ROOT ?? process.cwd());
  const manifestPath = path.join(root, "package.json");
  if (!await regularFile(root, manifestPath)) {
    return { ok: false, reason: "The MCP workspace must have a package.json file." } as const;
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    scripts?: { test?: string };
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const testDirectory = testScriptPattern.exec(manifest.scripts?.test ?? "")?.[1];
  if (!testDirectory || !(manifest.devDependencies?.tsx || manifest.dependencies?.tsx)) {
    return { ok: false, reason: "Expected a declared tsx dependency and a test script such as tsx --test test/*.test.ts." } as const;
  }
  const directory = path.join(root, testDirectory);
  const directoryInfo = await lstat(directory).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!directoryInfo?.isDirectory() || !inside(root, await realpath(directory))) {
    return { ok: false, reason: "The configured test directory must already exist inside the workspace." } as const;
  }
  return { ok: true, root, manifestPath, manifest, testDirectory, directory } as const;
}

async function testWorkflow(tool: string, args: TestInput) {
  const startedAt = Date.now();
  const integration = tool === "ghostly_test_integration";
  const unsupported = (reason: string) => ({ tool, status: "unsupported", reason });
  if (args.module === undefined ? tool !== "ghostly_init" : !modulePattern.test(args.module)) {
    return unsupported("Provide a workspace-relative TypeScript module such as src/discount.ts.");
  }
  const workspace = await loadTestWorkspace();
  if (!workspace.ok) return unsupported(workspace.reason);
  const { root, manifestPath, testDirectory, directory } = workspace;
  const entries = await readdir(directory, { withFileTypes: true });
  const suiteEntries = entries.filter((entry) => entry.name.endsWith(".test.ts"));
  const validSuiteEntries = suiteEntries.filter((entry) => entry.isFile() && testFilePattern.test(entry.name));
  const discovery = args.module === undefined
    ? await discoverUnitCandidates(
      root, testDirectory, validSuiteEntries.map((entry) => `${testDirectory}/${entry.name}`).sort(),
      validSuiteEntries.length === suiteEntries.length,
    )
    : undefined;
  const discoveryReport = discovery && {
    candidates: discovery.candidates,
    modulesInspected: discovery.modulesInspected,
    testsInspected: discovery.testsInspected,
  };
  if (discovery && (args.mode === "plan" || !discovery.selected || !discovery.complete)) {
    const reason = !discovery.complete ? "The repository exceeds the supported discovery budget. Specify a module."
      : !discovery.selected ? "No uncovered case with an independent written expectation could be confirmed." : undefined;
    return {
      tool, status: args.mode === "plan" ? "planned" : "needs_input", ...discoveryReport,
      reason, changedFiles: [], durationMs: Date.now() - startedAt,
    };
  }
  const module = args.module ?? discovery?.selected?.evidence.file;
  if (!module) return unsupported("No supported module was selected.");
  const moduleFile = path.join(root, module);
  if (!await regularFile(root, moduleFile)) {
    return unsupported("The module must be a regular TypeScript file inside the workspace.");
  }
  const source = await readSmallFile(root, module);
  const integrationCase = integration && source ? integrationCaseFromSource(module, source) : undefined;
  if (integration && (!integrationCase ||
    !await regularFile(root, path.join(root, integrationCase.dependency.file)))) {
    return unsupported("Expected an @integrationExample and a direct named call to a separate relative TypeScript module inside the workspace.");
  }
  const candidate = integrationCase ?? discovery?.selected ?? (source &&
    candidatesFromSource(module, source).find((item) => item.assertion !== null));
  if (!candidate || candidate.assertion === null) {
    return unsupported("Expected a numeric @example or an explicitly documented inclusive boolean boundary on an exported function.");
  }
  const { functionName, behavior, assertion } = candidate;
  const relativeImport = path.relative(directory, moduleFile).split(path.sep).join("/");
  const importPath = relativeImport.startsWith("../") ? relativeImport : `./${relativeImport}`;
  const suffix = integration ? ".ghostly.integration.test.ts" : ".ghostly.test.ts";
  const fileName = `${path.basename(module, ".ts")}${suffix}`;
  const testFile = `${testDirectory}/${fileName}`;
  const outputFile = path.join(directory, fileName);
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
  const proposal = {
    tool,
    roles: { analysis: "tsx + node:test", planning: "Independent expectation documented in source" },
    ...discoveryReport,
    case: candidate,
    testFile,
    command: `node --import tsx --test ${testFile}`,
  };
  if (args.mode === "plan") {
    return { ...proposal, status: "planned", changedFiles: [], durationMs: Date.now() - startedAt };
  }

  try {
    createRequire(manifestPath).resolve("tsx");
  } catch {
    return unsupported("Install the project's declared tsx dependency before applying the plan.");
  }
  const priorFile = entries.find((entry) => entry.name.toLowerCase() === fileName.toLowerCase());
  if (priorFile && (!priorFile.isFile() || priorFile.name !== fileName ||
    await readFile(outputFile, "utf8") !== generated)) {
    return unsupported(`The target ${testFile} already exists with different content. It was preserved.`);
  }
  const suiteFiles = validSuiteEntries.filter((entry) => entry.name !== fileName)
    .map((entry) => `${testDirectory}/${entry.name}`).sort();
  const baseline = validSuiteEntries.length !== suiteEntries.length
    ? { status: "unavailable", reason: "The suite contains test entries outside the supported file convention." }
    : suiteFiles.length
      ? await runTests(root, suiteFiles)
      : { status: "empty" };

  if (!inside(root, await realpath(directory))) {
    return unsupported("The test directory moved outside the workspace during the baseline.");
  }
  if (!priorFile) {
    try {
      await writeFile(outputFile, generated, { flag: "wx" });
    } catch (error) {
      if (hasCode(error, "EEXIST")) return unsupported(`The target ${testFile} was created by another operation. Retry to use the existing file.`);
      throw error;
    }
  }
  const verification = await runTests(root, [testFile]);
  return {
    ...proposal,
    status: verification.status,
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

export function registerTestWorkflowTools(server: McpServer): void {
  for (const [name, description] of [
    ["ghostly_init", "Discover and rank TypeScript unit tests in the workspace, or scope to a module. Apply creates and runs the highest-priority supported uncovered case."],
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
