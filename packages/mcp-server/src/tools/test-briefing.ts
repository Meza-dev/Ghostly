import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { integrationCaseFromSource } from "./integration-discovery.js";
import { e2eFlow, prepareE2ETest, prepareRunId, runE2ETest } from "./test-e2e.js";
import {
  dependencyInstalled, hasCode, inspectTestSuite, loadTestWorkspace, prepareCodeTest,
  regularFile, runBaseline, runCodeTest, runnerReady, runTests, testWorkflow, type CodeCase, type TestWorkspace, type VerifyPlan,
} from "./test-unit.js";
import { candidatesFromSource, coverageOf, discoverCodeEvidence, readSmallFile } from "./unit-discovery.js";

const tool = "ghostly_init";
const choices = ["A", "B", "C"] as const;
const input = {
  mode: z.enum(["plan", "apply"]).default("plan"),
  module: z.string().optional().describe("Legacy direct unit test for a relative module. Omit to use the briefing."),
  scope: z.string().max(200).optional().describe("Optional workspace-relative source directory for briefing discovery."),
  testType: z.enum(["unit", "integration", "e2e"]).optional().describe("Limit the briefing to this test type."),
  layout: z.enum(["configured", "colocated"]).optional().describe("Requested layout. Only the existing configured test directory is supported."),
  e2e: e2eFlow.partial().optional().describe("Browser test inputs. Plan reports any missing fields."),
  selection: z.enum(choices).optional().describe("Explicitly approved option from a previous briefing."),
  selections: z.array(z.enum(choices)).min(1).max(3).refine((ids) => new Set(ids).size === ids.length)
    .optional().describe("Explicitly approved options from a previous briefing."),
  planToken: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Fingerprint returned by the briefing."),
};
const inputSchema = z.object(input).strict();
type BriefingInput = z.infer<typeof inputSchema>;
type TestType = NonNullable<BriefingInput["testType"]>;
type BrowserFlow = z.infer<typeof e2eFlow>;
type Suite = Awaited<ReturnType<typeof inspectTestSuite>>;
type Evidence = Awaited<ReturnType<typeof discoverCodeEvidence>>;
type Document = { file: "README.md"; text: string };
type Option = {
  testType: TestType;
  status: "ready" | "needs_input" | "unsupported";
  case: string;
  evidence: CodeCase["evidence"] | { source: "requested-browser-flow"; route: string } | null;
  plannedFiles: string[];
  configurationChanges: string[];
  reason: string;
  command?: string;
  missingInputs?: string[];
  assertion?: string;
  prerequisites?: string[];
  documentation?: CodeCase["documentation"];
};
type Prepared = { option: Option } & (
  { kind: "code"; testType: "unit" | "integration"; candidate: CodeCase } |
  { kind: "browser"; flow: BrowserFlow } |
  { kind: "unavailable" }
);

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const unchanged = { changedFiles: [], configurationChanges: [] };
const unsupported = (reason: string) => ({ tool, status: "unsupported", reason, options: [], ...unchanged });

async function validScope(workspace: TestWorkspace, scope: string): Promise<boolean> {
  if (scope === ".") return true;
  if (!/^[\w-]+(?:\/[\w-]+)*$/.test(scope)) return false;
  const directory = path.join(workspace.root, scope);
  try {
    return (await lstat(directory)).isDirectory() && path.relative(directory, await realpath(directory)) === "";
  } catch (error) {
    if (hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

async function prepareCodeOptions(
  args: BriefingInput, workspace: TestWorkspace, suite: Suite, evidence: Evidence, document?: Document,
) {
  const units: Prepared[] = [];
  const integrations: Prepared[] = [];
  const dependencies = new Map<string, string>();
  const alreadyCovered = new Set<string>();
  const coverageUncertain: Array<{
    testType: "unit" | "integration"; case: string; evidence: CodeCase["evidence"]; files: string[]; reason: string;
  }> = [];
  const documentedCases = new Map<string, { argument: number; expected: number | boolean; line: number } | null>();
  for (const [index, line] of document?.text.split(/\r?\n/).entries() ?? []) {
    const example = /^\s*-?\s*`([\w$]+)\((-?\d+(?:\.\d+)?)\) => (-?\d+(?:\.\d+)?|true|false)`\s*$/.exec(line);
    const name = example?.[1];
    if (!name) continue;
    const argument = Number(example[2]);
    const expected = example[3] === "true" ? true : example[3] === "false" ? false : Number(example[3]);
    if (!Number.isFinite(argument) || typeof expected === "number" && !Number.isFinite(expected)) continue;
    documentedCases.set(name, documentedCases.has(name) ? null : { argument, expected, line: index + 1 });
  }
  function offer(candidate: CodeCase, testType: "unit" | "integration", options: Prepared[]) {
    const coverage = coverageOf(candidate, evidence.suite, evidence.completeCoverage);
    if (coverage.status === "covered") {
      for (const file of coverage.files) alreadyCovered.add(file);
    }
    if (coverage.status === "unknown" && coverage.files.length && coverageUncertain.length < 10) {
      coverageUncertain.push({
        testType, case: candidate.behavior, evidence: candidate.evidence, files: coverage.files, reason: coverage.reason,
      });
    }
    if (coverage.status !== "uncovered") return;
    const prepared = prepareCodeTest(workspace, candidate, testType);
    if (suite.entries.some((entry) => entry.name.toLowerCase() === prepared.fileName.toLowerCase())) return;
    options.push({
      kind: "code", testType, candidate,
      option: {
        testType, status: "ready", case: candidate.behavior, evidence: candidate.evidence,
        assertion: candidate.assertion, plannedFiles: [prepared.testFile], configurationChanges: [],
        command: prepared.command, reason: candidate.reason, documentation: candidate.documentation,
      },
    });
  }
  for (const { file, source } of evidence.sources) {
    if (!args.testType || args.testType === "unit") {
      for (const candidate of candidatesFromSource(file, source)) {
        if (candidate.assertion !== null) {
          offer(candidate, "unit", units);
          continue;
        }
        // A README can document a numeric input/result independently of source.
        const documented = documentedCases.get(candidate.functionName);
        if (document && documented) {
          const { argument, expected, line } = documented;
          const declaration = source.split(/\r?\n/)[candidate.evidence.line - 1];
          const returnType = typeof expected === "boolean" ? "boolean" : "number";
          if (!declaration || !/^\s*export\s+function\s+/.test(declaration) ||
            !declaration.split("{")[0]?.trimEnd().endsWith(returnType)) continue;
          offer({
            ...candidate, argument, expected,
            behavior: `${candidate.functionName}(${argument}) returns ${expected}`,
            reason: "The README records the expected behavior independently of the implementation.",
            assertion: `assert.strictEqual(${candidate.functionName}(${argument}), ${expected})`,
            documentation: { file: document.file, line },
          }, "unit", units);
        }
      }
    }
    if (args.testType && args.testType !== "integration") continue;
    const integration = integrationCaseFromSource(file, source);
    if (!integration) continue;
    const dependency = integration.dependency.file;
    if (!dependencies.has(dependency) && await regularFile(workspace.root, path.join(workspace.root, dependency))) {
      const dependencySource = await readSmallFile(workspace.root, dependency);
      if (dependencySource !== undefined) dependencies.set(dependency, hash(dependencySource));
    }
    if (dependencies.has(dependency)) offer(integration, "integration", integrations);
  }
  units.sort((a, b) => Number(b.kind === "code" && typeof b.candidate.expected === "boolean") -
    Number(a.kind === "code" && typeof a.candidate.expected === "boolean"));
  return { units, integrations, dependencies: [...dependencies], alreadyCovered: [...alreadyCovered].sort(), coverageUncertain };
}

async function prepareBrowserOption(args: BriefingInput, workspace: TestWorkspace, suite: Suite): Promise<Prepared | undefined> {
  if (args.testType && args.testType !== "e2e") return;
  const declared = workspace.manifest.devDependencies?.playwright || workspace.manifest.dependencies?.playwright;
  if (!declared && !args.e2e && args.testType !== "e2e" && !workspace.setup) return;
  const missingInputs = Object.keys(e2eFlow.shape).filter((key) => args.e2e?.[key as keyof BrowserFlow] === undefined);
  const declarationLine = workspace.manifestText.split("\n").findIndex((line) => /"playwright"\s*:/.test(line)) + 1;
  const option: Option = {
    testType: "e2e", status: "needs_input", case: "Verify browser save acknowledgement and persistence after reload.",
    evidence: args.e2e?.route ? { source: "requested-browser-flow", route: args.e2e.route }
      : declared ? { file: "package.json", line: declarationLine || 1 } : null,
    plannedFiles: args.e2e?.name ? [`${workspace.testDirectory}/${args.e2e.name}.ghostly.e2e.test.ts`] : [],
    configurationChanges: [], missingInputs,
    prerequisites: ["Playwright declared and installed in the target package.", "Chromium installed for Playwright."],
    reason: "Supply the missing browser flow inputs using stable test IDs and synthetic data.",
  };
  if (!declared) return {
    kind: "unavailable", option: {
      ...option, status: missingInputs.length ? "needs_input" : "unsupported",
      reason: "The target package needs Playwright and its Chromium runtime. This briefing does not install browser dependencies.",
    },
  };
  const parsed = e2eFlow.safeParse(args.e2e);
  if (!parsed.success) return { kind: "unavailable", option };
  const preparedFlow = prepareRunId(parsed.data);
  if (!preparedFlow.ok) return {
    kind: "unavailable", option: { ...option, status: "unsupported", reason: preparedFlow.reason },
  };
  if (!dependencyInstalled(workspace, "playwright")) return {
    kind: "unavailable", option: { ...option, reason: "Install the declared Playwright dependency before applying." },
  };
  const prepared = prepareE2ETest(workspace, preparedFlow.flow);
  const existing = suite.entries.find((entry) => entry.name.toLowerCase() === prepared.fileName.toLowerCase());
  if (existing && (existing.name !== prepared.fileName || !existing.isFile() ||
    await readSmallFile(workspace.root, prepared.testFile) !== prepared.generated)) return {
    kind: "unavailable", option: { ...option, status: "unsupported", reason: "The planned test path already has different content." },
  };
  return {
    kind: "browser", flow: parsed.data,
    option: {
      ...option, status: "ready", plannedFiles: existing ? [] : [prepared.testFile],
      command: prepared.command, reason: "The supplied browser flow has explicit save and persistence checks.",
    },
  };
}

function selectOptions(code: Awaited<ReturnType<typeof prepareCodeOptions>>, browser?: Prepared) {
  const [unit, ...units] = code.units;
  const [integration, ...integrations] = code.integrations;
  return [unit, integration, browser, ...units, ...integrations]
    .filter((option): option is Prepared => option !== undefined).slice(0, choices.length);
}

function setupFiles(workspace: TestWorkspace): string[] {
  return workspace.setup ? ["package.json", ...(workspace.directoryExists ? [] : ["test/"])] : [];
}

async function prepareBriefing(args: BriefingInput, workspace: TestWorkspace, suite: Suite, evidence: Evidence) {
  const scope = args.scope ?? ".";
  const readme = await regularFile(workspace.root, path.join(workspace.root, "README.md"))
    ? await readSmallFile(workspace.root, "README.md") : undefined;
  const documentation = readme === undefined ? [] : [{ file: "README.md", lines: readme.split(/\r?\n/).length }];
  const code = await prepareCodeOptions(args, workspace, suite, evidence,
    readme === undefined ? undefined : { file: "README.md", text: readme });
  const browser = await prepareBrowserOption(args, workspace, suite);
  const prepared = selectOptions(code, browser);
  const options = prepared.map(({ option }, index) => ({
    id: choices[index], ...option,
    configurationChanges: option.status === "ready" ? setupFiles(workspace) : option.configurationChanges,
  }));
  const recommendation = options.find((option) => option.status === "ready");
  const runtimeReady = runnerReady(workspace);
  const reason = !runtimeReady
    ? workspace.runner === "native"
      ? "The built-in TypeScript test setup requires Node.js 24 or newer."
      : "Install the declared tsx dependency before applying."
    : !evidence.complete ? "The source scan is incomplete. Narrow the briefing scope."
      : !evidence.completeCoverage ? "The existing test suite could not be fully inspected."
        : !recommendation ? options[0]?.reason ?? "No supported uncovered case has an independent expectation." : undefined;
  const report = {
    tool, scope, options,
    stack: { language: "TypeScript", runtime: "Node.js", runner: workspace.runner === "native" ? "Node.js native TypeScript + node:test" : "tsx + node:test" },
    configuration: {
      layout: "configured", testDirectory: workspace.testDirectory,
      testScript: workspace.setup ? "node --test test/*.test.ts" : workspace.manifest.scripts?.test,
      initialSetup: workspace.setup,
      dependencies: [],
    },
    existingTests: suite.files.slice(0, 100),
    documentation,
    coveredBy: code.alreadyCovered,
    coverageUncertain: code.coverageUncertain,
    recommendedOption: reason ? undefined : recommendation?.id,
    recommendationReason: reason ? undefined : recommendation?.testType === "unit"
      ? "Start with a documented unit case that the existing suite does not appear to cover."
      : recommendation?.reason,
    ...unchanged,
  };
  const snapshot = {
    root: workspace.root, scope, testType: args.testType, layout: args.layout, e2e: args.e2e,
    manifest: hash(workspace.manifestText), directoryExists: workspace.directoryExists,
    sources: evidence.sources.map(({ file, source }) => [file, hash(source)] as const),
    suite: evidence.suite.map(({ file, source }) => [file, hash(source)] as const),
    dependencies: code.dependencies,
    documentation: readme === undefined ? [] : [["README.md", hash(readme)] as const],
    options,
  };
  const token = reason ? undefined : hash(JSON.stringify(snapshot));
  return { prepared, report, reason, token, snapshot, runtimeReady };
}

type Snapshot = Awaited<ReturnType<typeof prepareBriefing>>["snapshot"];

function changedFiles(before: ReadonlyArray<readonly [string, string]>, after: ReadonlyArray<readonly [string, string]>) {
  const previous = new Map(before);
  const current = new Map(after);
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((file) => previous.get(file) !== current.get(file)).sort();
}

function revalidate(args: BriefingInput, original: Snapshot): VerifyPlan {
  return async () => {
    try {
      const workspace = await loadTestWorkspace(true);
      if (!workspace.ok) return [{ kind: "configuration", files: ["package.json"] }];
      if (workspace.root !== original.root || !await validScope(workspace, original.scope)) {
        return [{ kind: "scope", files: [] }];
      }
      const suite = await inspectTestSuite(workspace);
      const evidence = await discoverCodeEvidence(
        workspace.root, workspace.testDirectory, suite.files, suite.complete, original.scope,
      );
      const { token, snapshot } = await prepareBriefing(args, workspace, suite, evidence);
      if (token === args.planToken) return;

      const drift = original.manifest === snapshot.manifest ? [] : [{ kind: "configuration", files: ["package.json"] }];
      if (original.directoryExists !== snapshot.directoryExists) drift.push({ kind: "configuration", files: ["test/"] });
      for (const [kind, before, after] of [
        ["source", original.sources, snapshot.sources],
        ["suite", original.suite, snapshot.suite],
        ["dependency", original.dependencies, snapshot.dependencies],
        ["documentation", original.documentation, snapshot.documentation],
      ] as const) {
        const files = changedFiles(before, after);
        if (files.length) drift.push({ kind, files });
      }
      if (JSON.stringify(original.options) !== JSON.stringify(snapshot.options)) {
        drift.push({ kind: "options", files: [] });
      }
      return drift.length ? drift : [{ kind: "workspace", files: [] }];
    } catch {
      return [{ kind: "workspace", files: [] }];
    }
  };
}

async function writeSetup(workspace: TestWorkspace) {
  if (await readFile(workspace.manifestPath, "utf8") !== workspace.manifestText) return false;
  if (!workspace.directoryExists) await mkdir(workspace.directory);
  const manifest = { ...workspace.manifest, scripts: { ...workspace.manifest.scripts, test: "node --test test/*.test.ts" } };
  const indent = /\n([ \t]+)"/.exec(workspace.manifestText)?.[1] ?? 2;
  await writeFile(workspace.manifestPath, JSON.stringify(manifest, null, indent) + "\n", "utf8");
  return true;
}

async function briefing(args: BriefingInput) {
  if (args.module !== undefined) {
    if (args.scope !== undefined || args.testType || args.layout || args.e2e || args.selection || args.selections || args.planToken) {
      return unsupported("Use either a direct module request or a briefing selection. Do not combine their inputs.");
    }
    return testWorkflow(tool, args);
  }
  if (args.selection && args.selections) return unsupported("Use selection or selections, not both.");
  if (args.layout === "colocated") {
    return unsupported("Tests next to source are unsupported. This workflow writes to the existing configured test directory.");
  }
  const workspace = await loadTestWorkspace(true);
  if (!workspace.ok) {
    return {
      ...unsupported(workspace.reason),
      status: args.mode === "apply" && args.planToken ? "plan_changed" : "unsupported",
      stack: workspace.detected,
      expectedSetup: "Install the declared tsx dependency and use an existing flat directory matched by tsx --test test/*.test.ts.",
    };
  }
  const scope = args.scope ?? ".";
  if (!await validScope(workspace, scope)) return unsupported("Scope must be an existing relative source directory inside the workspace.");
  const suite = await inspectTestSuite(workspace);
  const evidence = await discoverCodeEvidence(workspace.root, workspace.testDirectory, suite.files, suite.complete, scope);
  const { prepared, report, reason, token, snapshot, runtimeReady } = await prepareBriefing(args, workspace, suite, evidence);
  if (args.mode === "plan") {
    const status = token ? "ready"
      : !runtimeReady && workspace.runner === "native" || report.options[0]?.status === "unsupported" ? "unsupported" : "needs_input";
    return { ...report, status, reason, planToken: token };
  }
  const selectedIds = args.selections ?? (args.selection ? [args.selection] : []);
  let selected = selectedIds.map((id) => prepared[choices.indexOf(id)]);
  let approvedInputs = args;
  let approvedSnapshot = snapshot;
  if (!selectedIds.length || !args.planToken) {
    const unavailable = selected.find((choice) => choice?.kind === "unavailable");
    if (unavailable) {
      return {
        ...report, status: unavailable.option.status, reason: unavailable.option.reason,
        missingInputs: unavailable.option.missingInputs,
      };
    }
    return { ...report, status: "needs_input", reason: "Confirm a briefing option and supply its plan token before applying." };
  }
  if (args.planToken !== token) {
    // A redundant type constraint must refer to the approved choice's original position.
    const original = args.testType
      ? await prepareBriefing({ ...args, testType: undefined }, workspace, suite, evidence)
      : undefined;
    const approved = selectedIds.map((id) => original?.prepared[choices.indexOf(id)]);
    if (original?.token !== args.planToken || approved.some((choice) => choice?.option.testType !== args.testType)) {
      return { ...report, status: "plan_changed", reason: "Create a fresh briefing and confirm its option." };
    }
    selected = approved;
    approvedInputs = { ...args, testType: undefined };
    approvedSnapshot = original.snapshot;
  }
  const ready = selected.filter((choice): choice is Exclude<Prepared, { kind: "unavailable" }> =>
    choice !== undefined && choice.kind !== "unavailable");
  if (ready.length !== selectedIds.length) {
    const unavailable = selected.find((choice) => choice?.kind === "unavailable");
    return {
      ...report, status: "needs_input", reason: unavailable?.option.reason ?? "Select an option from the briefing.",
      missingInputs: unavailable?.option.missingInputs,
    };
  }
  const outputPaths = ready.flatMap(({ option }) => option.plannedFiles.map((file) => file.toLowerCase()));
  if (new Set(outputPaths).size !== outputPaths.length) return unsupported("The selected cases share a destination. Select one case per test file.");
  const verifyPlan = revalidate(approvedInputs, approvedSnapshot);
  const execute = async (
    choice: typeof ready[number], beforeWrite?: VerifyPlan, baseline?: Awaited<ReturnType<typeof runBaseline>>,
    deferExecution = false,
  ) =>
    choice.kind === "code"
      ? runCodeTest(tool, "apply", workspace, suite, choice.candidate, choice.testType, Date.now(), beforeWrite, baseline, deferExecution)
      : {
        ...await runE2ETest({ mode: "apply", ...choice.flow }, workspace, beforeWrite, deferExecution),
        baseline: baseline ?? { status: "unavailable", reason: "The browser option runs only the selected browser test." },
      };
  const single = ready[0];
  if (single && ready.length === 1 && !workspace.setup && !args.selections) {
    const result = await execute(single, verifyPlan);
    return { ...unchanged, ...result, tool, selection: args.selection, testType: single.option.testType };
  }
  const baseline = await runBaseline(workspace, suite);
  const drift = await verifyPlan();
  if (drift) return { ...report, status: "plan_changed", reason: "The workspace changed before generation.", drift, baseline };
  const configurationChanges = setupFiles(workspace);
  if (workspace.setup && !await writeSetup(workspace)) {
    return { ...report, status: "plan_changed", reason: "The package manifest changed before setup.", baseline };
  }
  const generated = [];
  for (const [index, choice] of ready.entries()) {
    const result = await execute(choice, undefined, baseline, true);
    generated.push({ ...result, selection: selectedIds[index], testType: choice.option.testType });
  }
  const results = [];
  for (const result of generated) {
    if (result.status !== "generated" || !("testFile" in result) || !result.testFile) {
      results.push(result);
      continue;
    }
    const verification = await runTests(
      workspace.root, [result.testFile], "environment" in result ? result.environment : {}, workspace.runner,
    );
    results.push({ ...result, status: verification.status, verification });
  }
  const status = results.find((result) => result.status !== "passed" && result.status !== "failed")?.status ??
    (results.some((result) => result.status === "failed") ? "failed" : "passed");
  if (results.length === 1 && !args.selections) {
    return { ...unchanged, ...results[0], tool, configurationChanges };
  }
  return {
    tool, status, baseline, selections: selectedIds, results, configurationChanges,
    changedFiles: results.flatMap((result) => "changedFiles" in result ? result.changedFiles ?? [] : []),
  };
}

export function registerTestBriefingTool(server: McpServer): void {
  server.registerTool(tool, {
    description: "Plan supported repository test options. Apply only an explicitly selected option with its current plan token.",
    inputSchema,
  },
    async (args): Promise<CallToolResult> => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await briefing(args), null, 2) }] };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ tool, status: "error", reason, ...unchanged }) }],
          isError: true,
        };
      }
    });
}
