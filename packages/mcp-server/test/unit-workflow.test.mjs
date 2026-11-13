import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const manifest = {
  type: "module",
  scripts: { test: "tsx --test test/*.test.ts" },
  devDependencies: { tsx: "^4.0.0" },
};

async function fixture(t) {
  const repo = await mkdtemp(fileURLToPath(new URL("../unit-fixture-", import.meta.url)));
  const client = new Client({ name: "ghostly-unit-fixture", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await rm(repo, { recursive: true, force: true, maxRetries: 5 });
  });
  await mkdir(path.join(repo, "src"));
  await mkdir(path.join(repo, "test"));
  const manifestPath = path.join(repo, "package.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const serverArgs = process.env.GHOSTLY_TEST_PACKAGED_MCP === "1"
    ? [fileURLToPath(new URL("../../cli/dist/assets/mcp-server/index.js", import.meta.url))]
    : ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArgs,
    cwd: repo,
    env: { GHOST_TARGET_PROJECT_ROOT: repo },
  });
  await client.connect(transport);
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  return { repo, client, call, manifestPath };
}

test("MCP plans, generates and re-runs a TypeScript unit test", async (t) => {
  const { repo, client, call, manifestPath } = await fixture(t);
  const modulePath = "src/discount.ts";
  const generatedPath = path.join(repo, "test/discount.ghostly.test.ts");
  const source = (factor) => `/** @example discount(200) => 20 */
export function discount(total: number): number {
  return total * ${factor};
}
`;
  await writeFile(path.join(repo, modulePath), source(0.1));
  const baselinePath = path.join(repo, "test/existing.test.ts");
  const baseline = `import assert from "node:assert/strict";
import { test } from "node:test";
test("existing test", () => assert.equal(2 + 2, 4));
`;
  await writeFile(baselinePath, baseline);

  const { tools } = await client.listTools();
  for (const name of ["ghostly_init", "ghostly_test_unit", "ghostly_run_flow", "get_run"]) {
    assert.ok(tools.some((tool) => tool.name === name), name);
  }
  const plan = await call("ghostly_init", { mode: "plan", module: modulePath });
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.case.evidence, { file: modulePath, line: 1 });
  assert.equal(plan.case.expected, 20);
  assert.equal(plan.testFile, "test/discount.ghostly.test.ts");
  await assert.rejects(readFile(generatedPath), { code: "ENOENT" });

  const unsupported = await call("ghostly_init", { mode: "apply", module: "../outside.ts" });
  assert.equal(unsupported.status, "unsupported");
  await assert.rejects(readFile(generatedPath), { code: "ENOENT" });

  const applied = await call("ghostly_test_unit", { mode: "apply", module: modulePath });
  assert.equal(applied.status, "passed", JSON.stringify(applied));
  assert.equal(applied.baseline.status, "passed");
  assert.deepEqual(applied.changedFiles, [plan.testFile]);
  assert.equal(applied.command, "node --import tsx --test test/discount.ghostly.test.ts");
  const frozen = await readFile(generatedPath, "utf8");
  assert.match(frozen, /assert\.strictEqual\(discount\(200\), 20\)/);
  assert.equal(await readFile(baselinePath, "utf8"), baseline);

  await writeFile(baselinePath, baseline.replace("2 + 2, 4", "2 + 2, 5"));
  const preexistingFailure = await call("ghostly_init", { mode: "apply", module: modulePath });
  assert.equal(preexistingFailure.baseline.status, "failed");
  assert.equal(preexistingFailure.status, "passed");
  assert.deepEqual(preexistingFailure.changedFiles, []);

  await writeFile(path.join(repo, modulePath), source(0));
  const broken = await call("ghostly_init", { mode: "apply", module: modulePath });
  assert.equal(broken.status, "failed", JSON.stringify(broken));
  assert.match(broken.verification.output, /ERR_ASSERTION/);
  assert.deepEqual(broken.changedFiles, []);
  assert.equal(await readFile(generatedPath, "utf8"), frozen);

  await writeFile(generatedPath, "// User-edited test");
  const conflict = await call("ghostly_test_unit", { mode: "apply", module: modulePath });
  assert.equal(conflict.status, "unsupported");
  assert.equal(await readFile(generatedPath, "utf8"), "// User-edited test");

  await writeFile(manifestPath, JSON.stringify({ ...manifest, scripts: { test: "other-runner" } }));
  const unknown = await call("ghostly_init", { mode: "plan", module: modulePath });
  assert.equal(unknown.status, "unsupported");
});

test("MCP briefs repository choices and applies only a selected current option", async (t) => {
  const { repo, call, manifestPath } = await fixture(t);
  await writeFile(manifestPath, JSON.stringify({
    ...manifest, devDependencies: { ...manifest.devDependencies, playwright: "^1.59.1" },
  }));
  const boundary = (operator) => `/** Returns true exactly when age is at least 18. */
export function isEligible(age: number): boolean { return age ${operator} 18; }
`;
  const eligibility = path.join(repo, "src/eligibility.ts");
  const existing = path.join(repo, "test/discount.test.ts");
  const existingSource = `import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { discount as applyDiscount } from "../src/discount.ts";
writeFileSync(new URL("../baseline-executed", import.meta.url), "");
test("discount rule", () => assert.strictEqual(applyDiscount(200), 20));
`;
  await writeFile(eligibility, boundary(">="));
  await writeFile(existing, existingSource);
  await writeFile(path.join(repo, "src/discount.ts"), `/** @example discount(200) => 20 */
export function discount(total: number): number { return total * 0.1; }
`);
  const checkout = path.join(repo, "src/checkout.ts");
  const checkoutSource = `import { discount } from "./discount.ts";
/** @integrationExample checkoutTotal(200) => 180 */
export function checkoutTotal(subtotal: number): number { return subtotal - discount(subtotal); }
`;
  await writeFile(checkout, checkoutSource);

  const unitTest = path.join(repo, "test/eligibility.ghostly.test.ts");
  const integrationTest = "test/checkout.ghostly.integration.test.ts";
  const baselineMarker = path.join(repo, "baseline-executed");
  const request = { scope: "src" };
  const plan = await call("ghostly_init", { mode: "plan", ...request });
  assert.equal(plan.status, "ready", JSON.stringify(plan));
  assert.equal(plan.recommendedOption, "A");
  assert.ok(plan.recommendationReason);
  assert.deepEqual(plan.options.map(({ id, testType, status }) => [id, testType, status]), [
    ["A", "unit", "ready"], ["B", "integration", "ready"], ["C", "e2e", "needs_input"],
  ]);
  assert.deepEqual(plan.options[1].plannedFiles, [integrationTest]);
  assert.deepEqual(plan.options[1].configurationChanges, []);
  assert.equal(plan.options[1].evidence.file, "src/checkout.ts");
  assert.equal(plan.options[2].evidence.file, "package.json");
  assert.deepEqual(plan.existingTests, ["test/discount.test.ts"]);
  assert.match(plan.planToken, /^[a-f0-9]{64}$/);
  const repeatPlan = await call("ghostly_init", { mode: "plan", ...request });
  assert.equal(repeatPlan.planToken, plan.planToken);
  const missingE2E = await call("ghostly_init", { mode: "plan", testType: "e2e", e2e: { name: "checkout" } });
  assert.equal(missingE2E.status, "needs_input");
  assert.deepEqual(missingE2E.options[0].missingInputs, ["baseUrl", "route", "steps", "acknowledgement", "persistence"]);

  const withoutSelection = await call("ghostly_init", { mode: "apply", ...request });
  assert.equal(withoutSelection.status, "needs_input");
  const unready = await call("ghostly_init", { mode: "apply", ...request, selection: "C", planToken: plan.planToken });
  assert.equal(unready.status, "needs_input");
  assert.ok(unready.missingInputs.includes("route"));
  const wrongType = await call("ghostly_init", { mode: "apply", ...request, testType: "unit", selection: "B", planToken: plan.planToken });
  assert.equal(wrongType.status, "plan_changed");
  const wrongLayout = await call("ghostly_init", { mode: "apply", ...request, layout: "colocated", selection: "A", planToken: plan.planToken });
  assert.equal(wrongLayout.status, "unsupported");
  const bypass = await call("ghostly_init", { mode: "apply", module: "src/eligibility.ts", selection: "B", planToken: plan.planToken });
  assert.equal(bypass.status, "unsupported");
  await writeFile(manifestPath, JSON.stringify({ ...manifest, scripts: { test: "vitest" } }));
  const incompatible = await call("ghostly_init", { mode: "plan", ...request });
  assert.equal(incompatible.status, "unsupported");
  assert.deepEqual(incompatible.options, []);
  const changedConfig = await call("ghostly_init", { mode: "apply", ...request, selection: "B", planToken: plan.planToken });
  assert.equal(changedConfig.status, "plan_changed");
  await writeFile(manifestPath, JSON.stringify({
    ...manifest, devDependencies: { ...manifest.devDependencies, playwright: "^1.59.1" },
  }));
  await writeFile(checkout, checkoutSource.replace("return subtotal", "return 0 + subtotal"));
  const stale = await call("ghostly_init", { mode: "apply", ...request, selection: "B", planToken: plan.planToken });
  assert.equal(stale.status, "plan_changed");
  await assert.rejects(readFile(baselineMarker), { code: "ENOENT" });
  await assert.rejects(readFile(unitTest), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(repo, integrationTest)), { code: "ENOENT" });

  await writeFile(checkout, checkoutSource);
  const applied = await call("ghostly_init", {
    mode: "apply", ...request, selection: "B", testType: "integration", planToken: plan.planToken,
  });
  assert.equal(applied.status, "passed", JSON.stringify(applied));
  assert.equal(applied.selection, "B");
  assert.equal(applied.baseline.status, "passed");
  assert.deepEqual(applied.changedFiles, [integrationTest]);
  assert.equal(applied.command, `node --import tsx --test ${integrationTest}`);
  assert.equal(await readFile(existing, "utf8"), existingSource);
  assert.match(await readFile(path.join(repo, integrationTest), "utf8"), /checkoutTotal\(200\), 180/);
  await assert.rejects(readFile(unitTest), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(repo, "test/discount.ghostly.test.ts")), { code: "ENOENT" });
});

test("MCP generates a replayable integration test and separates suite failures", async (t) => {
  const { repo, client, call } = await fixture(t);
  const module = "src/checkout.ts";
  const integrationSource = `import { discount as calculateDiscount } from "./pricing.ts";

/** @integrationExample checkoutTotal(200) => 180 */
export function checkoutTotal(subtotal: number): number {
  return subtotal - calculateDiscount(subtotal);
}
`;
  const pricing = path.join(repo, "src/pricing.ts");
  const pricingSource = (rate) => `export function discount(subtotal: number): number { return subtotal * ${rate}; }\n`;
  const existing = path.join(repo, "test/existing.test.ts");
  const existingSource = (expected) => `import assert from "node:assert/strict";
import { test } from "node:test";
test("pre-existing suite", () => assert.equal(2 + 2, ${expected}));
`;
  const generated = path.join(repo, "test/checkout.ghostly.integration.test.ts");
  await writeFile(path.join(repo, module), integrationSource);
  await writeFile(pricing, pricingSource(0.1));
  await writeFile(existing, existingSource(5));

  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "ghostly_test_integration"));
  const plan = await call("ghostly_test_integration", { mode: "plan", module });
  assert.equal(plan.status, "planned", JSON.stringify(plan));
  assert.deepEqual(plan.case.evidence, { file: module, line: 3 });
  assert.deepEqual(plan.case.dependency, { file: "src/pricing.ts", exportedName: "discount" });
  assert.equal(plan.case.assertion, "assert.strictEqual(checkoutTotal(200), 180)");
  assert.deepEqual(plan.changedFiles, []);
  await assert.rejects(readFile(generated), { code: "ENOENT" });

  await writeFile(path.join(repo, module), integrationSource.replace("subtotal - calculateDiscount(subtotal)", "subtotal"));
  const isolated = await call("ghostly_test_integration", { mode: "apply", module });
  assert.equal(isolated.status, "unsupported");
  await assert.rejects(readFile(generated), { code: "ENOENT" });
  await writeFile(path.join(repo, module), integrationSource);

  const applied = await call("ghostly_test_integration", { mode: "apply", module });
  assert.equal(applied.baseline.status, "failed", JSON.stringify(applied));
  assert.equal(applied.verification.status, "passed");
  assert.equal(applied.status, "passed");
  assert.equal(applied.command, "node --import tsx --test test/checkout.ghostly.integration.test.ts");
  assert.deepEqual(applied.changedFiles, ["test/checkout.ghostly.integration.test.ts"]);
  assert.equal(await readFile(existing, "utf8"), existingSource(5));
  const frozen = await readFile(generated, "utf8");
  assert.match(frozen, /assert\.strictEqual\(checkoutTotal\(200\), 180\)/);
  const replayEnv = { ...process.env };
  delete replayEnv.NODE_TEST_CONTEXT;
  const replay = execFileSync(process.execPath, [
    "--import", "tsx", "--test", "test/checkout.ghostly.integration.test.ts",
  ], { cwd: repo, env: replayEnv, encoding: "utf8", timeout: 10_000 });
  assert.match(replay, /checkoutTotal\(200\) returns 180/);

  await writeFile(existing, existingSource(4));
  await writeFile(pricing, pricingSource(0));
  const broken = await call("ghostly_test_integration", { mode: "apply", module });
  assert.equal(broken.baseline.status, "passed");
  assert.equal(broken.verification.status, "failed");
  assert.equal(broken.status, "failed");
  assert.match(broken.verification.output, /ERR_ASSERTION/);
  assert.deepEqual(broken.changedFiles, []);
  assert.equal(await readFile(generated, "utf8"), frozen);
});

test("MCP rejects briefing drift after the baseline and before generation", async (t) => {
  const { repo, call } = await fixture(t);
  await writeFile(path.join(repo, "src/value.ts"), `/** @example value(2) => 4 */
export function value(input: number): number { return input * 2; }
`);
  await writeFile(path.join(repo, "test/baseline.test.ts"), `import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
test("baseline changes the target", () => {
  const target = new URL("../src/value.ts", import.meta.url);
  writeFileSync(target, readFileSync(target, "utf8").replace("input * 2", "input * 3"));
});
`);
  const plan = await call("ghostly_init", { mode: "plan", scope: "src" });
  assert.equal(plan.status, "ready");
  const result = await call("ghostly_init", {
    mode: "apply", scope: "src", selection: "A", planToken: plan.planToken,
  });
  assert.equal(result.status, "plan_changed", JSON.stringify(result));
  assert.equal(result.baseline.status, "passed");
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(result.drift, [{ kind: "source", files: ["src/value.ts"] }]);
  await assert.rejects(readFile(path.join(repo, "test/value.ghostly.test.ts")), { code: "ENOENT" });
});

test("MCP distinguishes zero effective tests and execution errors", async (t) => {
  const { repo, call } = await fixture(t);
  await writeFile(path.join(repo, "src/value.ts"), `import "./unavailable.ts";
/** @example value(2) => 4 */
export function value(input: number): number { return input * 2; }
`);
  await writeFile(path.join(repo, "test/no-tests.test.ts"), "export const value = 1;\n");
  await writeFile(path.join(repo, "test/skipped.test.ts"), `import { test } from "node:test";
test.skip("skipped", () => {});
test.todo("todo");
`);
  const result = await call("ghostly_test_unit", { mode: "apply", module: "src/value.ts" });
  assert.equal(result.baseline.status, "no_tests", JSON.stringify(result));
  assert.equal(result.verification.status, "error");
  assert.match(result.verification.output, /unavailable/);
});

test("MCP counts only active exact assertions as coverage", async (t) => {
  const { repo, call } = await fixture(t);
  for (const name of ["active", "commented", "skipped", "otherInput", "otherExpected", "otherFunction"]) {
    await writeFile(path.join(repo, `src/${name}.ts`), `/** @example value(2) => 4 */
export function value(input: number): number { return input * 2; }
export function other(input: number): number { return input + 2; }
`);
  }
  const bodies = {
    active: 'test("active", () => assert.strictEqual(value(2), 4));',
    commented: '/* test("fake", () => assert.strictEqual(value(2), 4)); */',
    skipped: 'test.skip("skip", () => assert.strictEqual(value(2), 4));',
    otherInput: 'test("other input", () => assert.strictEqual(value(3), 6));',
    otherExpected: 'test("other result", () => assert.strictEqual(value(2), 5));',
    otherFunction: 'test("other fn", () => assert.strictEqual(other(2), 4));',
  };
  for (const [name, body] of Object.entries(bodies)) {
    await writeFile(path.join(repo, `test/${name}.test.ts`), `import assert from "node:assert/strict";
import { test } from "node:test";
import { value, other } from "../src/${name}.ts";
${body}
`);
  }
  const plan = await call("ghostly_init", { mode: "plan", scope: "src" });
  assert.deepEqual(plan.coveredBy, ["test/active.test.ts"], JSON.stringify(plan));
  assert.ok(plan.coverageUncertain.some((item) =>
    item.evidence.file === "src/otherInput.ts" && item.files.includes("test/otherInput.test.ts")));
  assert.equal(plan.status, "needs_input");
});
