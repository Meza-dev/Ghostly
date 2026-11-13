const summaryPrefix = "\n# ghostly-run-result ";

// Use Node's test events for machine results and retain TAP for readable diagnostics.
const reporter = `
import { tap } from "node:test/reporters";
import path from "node:path";
export default async function* (events) {
  const counts = { passed: 0, assertions: 0, errors: 0, effectiveTests: 0 };
  async function* measure() {
    for await (const event of events) {
      const { type, data } = event;
      if ((type === "test:pass" || type === "test:fail") && !data.skip && !data.todo) {
        const error = data.details?.error;
        const fileWrapper = data.line === 1 && data.column === 1 &&
          typeof data.name === "string" && typeof data.file === "string" &&
          path.resolve(data.name) === path.resolve(data.file);
        if (error?.failureType !== "subtestsFailed") {
          if (!fileWrapper && data.details?.type !== "suite") counts.effectiveTests++;
          if (type === "test:fail") {
            if (error?.failureType === "testCodeFailure" && error.cause?.code === "ERR_ASSERTION") counts.assertions++;
            else counts.errors++;
          } else if (!fileWrapper && data.details?.type !== "suite") {
            counts.passed++;
          }
        }
      }
      yield event;
    }
  }
  yield* tap(measure());
  yield ${JSON.stringify(summaryPrefix)} + JSON.stringify(counts) + "\\n";
}
`;

export const nodeTestReporter = `--test-reporter=data:text/javascript;base64,${Buffer.from(reporter).toString("base64")}`;

type Counts = { passed: number; assertions: number; errors: number; effectiveTests: number };

export function readNodeTestResult(code: unknown, stdout: string, stderr: string, fallback = "") {
  const index = stdout.lastIndexOf(summaryPrefix);
  let counts: Counts | undefined;
  if (index >= 0) {
    try {
      counts = JSON.parse(stdout.slice(index + summaryPrefix.length)) as Counts;
    } catch {
      // A terminated runner can leave an incomplete summary.
    }
  }
  const output = [index >= 0 ? stdout.slice(0, index) : stdout, stderr].filter(Boolean).join("\n") || fallback;
  const status = !counts || counts.errors || (code !== 0 && code !== 1) ? "error"
    : code === 1 ? counts.assertions ? "failed" : "error"
      : counts.passed ? "passed" : "no_tests";
  return { status, effectiveTests: counts?.effectiveTests ?? 0, output } as const;
}
