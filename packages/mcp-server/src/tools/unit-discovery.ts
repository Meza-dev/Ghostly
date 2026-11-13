import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { inspectTestReference } from "./coverage-evidence.js";

export const modulePattern = /^(?:[\w-]+\/)*[\w-]+\.ts$/;
const declaration = /(?:^|\n)[ \t]*(?:\/\*\*([\s\S]*?)\*\/[ \t\r\n]*)?export[ \t]+function[ \t]+([a-zA-Z_$][\w$]*)[ \t]*\([ \t]*([a-zA-Z_$][\w$]*)[ \t]*:[ \t]*number[ \t]*\)[ \t]*:[ \t]*(number|boolean)[ \t]*\{/g;
const number = "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?";
const maxFileSize = 128 * 1024;
const ignored = new Set(["node_modules", "dist", "build", "coverage", "vendor", "fixtures"]);

type Coverage = { status: "uncovered" | "covered" | "unknown"; reason: string; files: string[] };
type Evidence = { file: string; line: number };

export type SupportedCase = {
  evidence: Evidence;
  functionName: string;
  argument: number;
  expected: number | boolean;
  behavior: string;
  reason: string;
  assertion: string;
};

export type UnitCandidate = SupportedCase | {
  evidence: Evidence;
  functionName: string;
  behavior: string;
  reason: string;
  assertion: null;
};

type SuiteTest = { file: string; source: string };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readSmallFile(root: string, file: string): Promise<string | undefined> {
  const absolute = path.join(root, file);
  const info = await lstat(absolute);
  if (!info.isFile() || info.size > maxFileSize) return undefined;
  return readFile(absolute, "utf8");
}

export function candidatesFromSource(file: string, source: string): UnitCandidate[] {
  return [...source.matchAll(declaration)].flatMap<UnitCandidate>((match) => {
    const [text, comment, functionName, parameter, returnType] = match;
    if (!functionName || !parameter) return [];
    const name = escapeRegex(functionName);
    const example = returnType === "number"
      ? new RegExp(`@example[ \\t]+${name}\\((${number})\\)[ \\t]*=>[ \\t]*(${number})(?=[ \\t\\r\\n]|$)`).exec(comment ?? "")
      : null;
    const contract = returnType === "boolean"
      ? new RegExp(`Returns true exactly when ${escapeRegex(parameter)} is at least (-?\\d+)\\.`).exec(comment ?? "")
      : null;
    const index = example || contract ? text.indexOf(example?.[0] ?? contract?.[0] ?? "") : text.indexOf("export");
    const evidence = { file, line: source.slice(0, match.index + index).split("\n").length };
    const argument = Number(example?.[1] ?? contract?.[1]);
    const expected = example ? Number(example[2]) : true;
    if ((example || contract) && Number.isFinite(argument) &&
      (typeof expected === "boolean" ? Number.isSafeInteger(argument) : Number.isFinite(expected))) {
      return [{
        evidence,
        functionName,
        argument,
        expected,
        behavior: `${functionName}(${argument}) returns ${expected}`,
        reason: contract
          ? "The documented inclusive boundary specifies the expected result independently of the function body."
          : "The exported function documents an expected result for this input.",
        assertion: `assert.strictEqual(${functionName}(${argument}), ${expected})`,
      }];
    }
    return [{
      evidence,
      functionName,
      behavior: `Verify the documented behavior of ${functionName}.`,
      reason: "No supported written expectation was found. Specify the intended behavior before generating a test.",
      assertion: null,
    }];
  });
}

async function discoverSources(root: string, testDirectory: string, scope: string) {
  const folders = [scope === "." ? "" : scope];
  const modules: string[] = [];
  let inspected = 0;
  while (folders.length) {
    const folder = folders.pop() ?? "";
    const entries = await readdir(path.join(root, folder), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (++inspected > 2_000) return { modules: [], complete: false };
      const relative = path.posix.join(folder, entry.name);
      if (entry.isDirectory() && /^[\w-]+$/.test(entry.name) && !ignored.has(entry.name) &&
        relative !== testDirectory) {
        folders.push(relative);
      }
      if (entry.isFile() && modulePattern.test(relative)) modules.push(relative);
    }
    if (folders.length + modules.length > 500) return { modules: [], complete: false };
  }
  return { modules: modules.sort(), complete: true };
}

export function coverageOf(candidate: UnitCandidate, suite: SuiteTest[], complete: boolean): Coverage {
  if (candidate.assertion === null) {
    return { status: "unknown", reason: "The case lacks an independent written expectation.", files: [] };
  }
  const files: string[] = [];
  const covered: string[] = [];
  for (const test of suite) {
    const evidence = inspectTestReference(test.file, test.source, candidate);
    if (evidence.referenced) files.push(test.file);
    if (evidence.covered) covered.push(test.file);
  }
  if (covered.length) {
    return { status: "covered", reason: "Found an active direct assertion for this exact case.", files: covered };
  }
  if (!complete || files.length) {
    return {
      status: "unknown",
      reason: files.length
        ? "The suite imports the function or module, but an equivalent assertion could not be established."
        : "Some suite files could not be inspected.",
      files,
    };
  }
  return { status: "uncovered", reason: "No direct assertion or function import found in the inspected suite.", files: [] };
}

export async function discoverCodeEvidence(
  root: string, testDirectory: string, suiteFiles: string[], completeSuite: boolean, scope: string,
) {
  const { modules, complete } = await discoverSources(root, testDirectory, scope);
  const suite: SuiteTest[] = [];
  for (const file of suiteFiles.slice(0, 100)) {
    const source = await readSmallFile(root, file);
    if (source !== undefined) suite.push({ file, source });
  }
  const completeCoverage = completeSuite && suite.length === suiteFiles.length;
  const sources: SuiteTest[] = [];
  for (const file of modules) {
    const source = await readSmallFile(root, file);
    if (source !== undefined) sources.push({ file, source });
  }
  return { sources, suite, complete: complete && sources.length === modules.length, completeCoverage };
}
