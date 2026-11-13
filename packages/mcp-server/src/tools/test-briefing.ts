import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { integrationCaseFromSource } from "./integration-discovery.js";
import { e2eFlow, prepareE2ETest, prepareRunId, runE2ETest } from "./test-e2e.js";
import {
  dependencyInstalled, hasCode, inspectTestSuite, loadTestWorkspace, prepareCodeTest,
  regularFile, runCodeTest, testWorkflow, type CodeCase, type TestWorkspace, type VerifyPlan,
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
  planToken: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Fingerprint returned by the briefing."),
};
const inputSchema = z.object(input).strict();
type BriefingInput = z.infer<typeof inputSchema>;
type TestType = NonNullable<BriefingInput["testType"]>;
type BrowserFlow = z.infer<typeof e2eFlow>;
type Suite = Awaited<ReturnType<typeof inspectTestSuite>>;
type Evidence = Awaited<ReturnType<typeof discoverCodeEvidence>>;
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
  args: BriefingInput, workspace: TestWorkspace, suite: Suite, evidence: Evidence,
) {
  const units: Prepared[] = [];
  const integrations: Prepared[] = [];
  const dependencies = new Map<string, string>();
  const alreadyCovered = new Set<string>();
  const coverageUncertain: Array<{
    testType: "unit" | "integration"; case: string; evidence: CodeCase["evidence"]; files: string[]; reason: string;
  }> = [];
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
        command: prepared.command, reason: candidate.reason,
      },
    });
  }
  for (const { file, source } of evidence.sources) {
    if (!args.testType || args.testType === "unit") {
      for (const candidate of candidatesFromSource(file, source)) {
        if (candidate.assertion !== null) offer(candidate, "unit", units);
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
  if (!declared && !args.e2e && args.testType !== "e2e") return;
  const missingInputs = Object.keys(e2eFlow.shape).filter((key) => args.e2e?.[key as keyof BrowserFlow] === undefined);
  const declarationLine = workspace.manifestText.split("\n").findIndex((line) => /"playwright"\s*:/.test(line)) + 1;
  const option: Option = {
    testType: "e2e", status: "needs_input", case: "Verify browser save acknowledgement and persistence after reload.",
    evidence: args.e2e?.route ? { source: "requested-browser-flow", route: args.e2e.route }
      : declared ? { file: "package.json", line: declarationLine || 1 } : null,
    plannedFiles: args.e2e?.name ? [`${workspace.testDirectory}/${args.e2e.name}.ghostly.e2e.test.ts`] : [],
    configurationChanges: [], missingInputs,
    reason: "Supply the missing browser flow inputs using stable test IDs and synthetic data.",
  };
  if (!declared) return {
    kind: "unavailable", option: { ...option, status: "unsupported", reason: "The target package does not declare Playwright." },
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

async function prepareBriefing(args: BriefingInput, workspace: TestWorkspace, suite: Suite, evidence: Evidence) {
  const scope = args.scope ?? ".";
  const code = await prepareCodeOptions(args, workspace, suite, evidence);
  const browser = await prepareBrowserOption(args, workspace, suite);
  const prepared = selectOptions(code, browser);
  const options = prepared.map(({ option }, index) => ({ id: choices[index], ...option }));
  const recommendation = options.find((option) => option.status === "ready");
  const runtimeReady = dependencyInstalled(workspace, "tsx");
  const reason = !runtimeReady ? "Install the declared tsx dependency before applying."
    : !evidence.complete ? "The source scan is incomplete. Narrow the briefing scope."
      : !evidence.completeCoverage ? "The existing test suite could not be fully inspected."
        : !recommendation ? options[0]?.reason ?? "No supported uncovered case has an independent expectation." : undefined;
  const report = {
    tool, scope, options,
    stack: { language: "TypeScript", runtime: "Node.js", runner: "tsx + node:test" },
    configuration: { layout: "configured", testDirectory: workspace.testDirectory, testScript: workspace.manifest.scripts?.test },
    existingTests: suite.files.slice(0, 100),
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
    manifest: hash(workspace.manifestText),
    sources: evidence.sources.map(({ file, source }) => [file, hash(source)] as const),
    suite: evidence.suite.map(({ file, source }) => [file, hash(source)] as const),
    dependencies: code.dependencies,
    options,
  };
  const token = reason ? undefined : hash(JSON.stringify(snapshot));
  return { prepared, report, reason, token, snapshot };
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
      const workspace = await loadTestWorkspace();
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
      for (const [kind, before, after] of [
        ["source", original.sources, snapshot.sources],
        ["suite", original.suite, snapshot.suite],
        ["dependency", original.dependencies, snapshot.dependencies],
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

async function briefing(args: BriefingInput) {
  if (args.module !== undefined) {
    if (args.scope !== undefined || args.testType || args.layout || args.e2e || args.selection || args.planToken) {
      return unsupported("Use either a direct module request or a briefing selection. Do not combine their inputs.");
    }
    return testWorkflow(tool, args);
  }
  if (args.layout === "colocated") {
    return unsupported("Tests next to source are unsupported. This workflow writes to the existing configured test directory.");
  }
  const workspace = await loadTestWorkspace();
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
  const { prepared, report, reason, token, snapshot } = await prepareBriefing(args, workspace, suite, evidence);
  if (args.mode === "plan") {
    const status = token ? "ready" : report.options[0]?.status === "unsupported" ? "unsupported" : "needs_input";
    return { ...report, status, reason, planToken: token };
  }
  let selected = args.selection ? prepared[choices.indexOf(args.selection)] : undefined;
  let approvedInputs = args;
  let approvedSnapshot = snapshot;
  if (!args.selection || !args.planToken) {
    if (selected?.kind === "unavailable") {
      return {
        ...report, status: selected.option.status, reason: selected.option.reason,
        missingInputs: selected.option.missingInputs,
      };
    }
    return { ...report, status: "needs_input", reason: "Confirm a briefing option and supply its plan token before applying." };
  }
  if (args.planToken !== token) {
    // A redundant type constraint must refer to the approved choice's original position.
    const original = args.testType
      ? await prepareBriefing({ ...args, testType: undefined }, workspace, suite, evidence)
      : undefined;
    const approved = original?.prepared[choices.indexOf(args.selection)];
    if (original?.token !== args.planToken || approved?.option.testType !== args.testType) {
      return { ...report, status: "plan_changed", reason: "Create a fresh briefing and confirm its option." };
    }
    selected = approved;
    approvedInputs = { ...args, testType: undefined };
    approvedSnapshot = original.snapshot;
  }
  if (!selected || selected.kind === "unavailable") {
    return {
      ...report, status: "needs_input", reason: selected?.option.reason ?? "Select an option from the briefing.",
      missingInputs: selected?.option.missingInputs,
    };
  }
  const verifyPlan = revalidate(approvedInputs, approvedSnapshot);
  const result = selected.kind === "code"
    ? await runCodeTest(tool, "apply", workspace, suite, selected.candidate, selected.testType, Date.now(), verifyPlan)
    : {
      ...await runE2ETest({ mode: "apply", ...selected.flow }, workspace, verifyPlan),
      baseline: { status: "unavailable", reason: "The browser option runs only the selected browser test." },
    };
  return { ...unchanged, ...result, tool, selection: args.selection, testType: selected.option.testType };
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
