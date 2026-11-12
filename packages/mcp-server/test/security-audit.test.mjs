import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP reports bounded defensive hygiene without exposing fixture values or reading outside scope", async (t) => {
  const parent = await mkdtemp(fileURLToPath(new URL("../audit-fixture-", import.meta.url)));
  const root = path.join(parent, "repo");
  const external = path.join(parent, "outside");
  const client = new Client({ name: "ghostly-audit-fixture", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    await rm(parent, { recursive: true, force: true, maxRetries: 5 });
  });
  for (const directory of [root, external, path.join(root, "src"), path.join(root, "node_modules"), path.join(root, ".private")]) {
    await mkdir(directory);
  }
  const fixtureValue = "dummy-value-only-for-test-12345";
  const source = `export const retry = 2;\nexport const apiKey = "${fixtureValue}";\nexport const password = "CHANGE_ME";\n`;
  const sourceFile = path.join(root, "src/config.ts");
  await writeFile(sourceFile, source);
  await writeFile(path.join(root, ".env"), `API_KEY="${fixtureValue}"\n`);
  await writeFile(path.join(root, "node_modules/skipped.ts"), source);
  await writeFile(path.join(root, ".private/skipped.ts"), source);
  await writeFile(path.join(root, "src/oversized.ts"), source + " ".repeat(260_000));
  await writeFile(path.join(external, "outside.ts"), source);
  let hasLink = true;
  try {
    await symlink(external, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    hasLink = false;
    t.diagnostic("The operating system denied creating the directory link fixture.");
  }
  await writeFile(path.join(root, "Dockerfile"), "FROM node:20\nUSER root\n");
  await writeFile(path.join(root, "package.json"), `{\n  "dependencies": {\n    "fixture-package": "*"\n  }\n}\n`);

  const serverArgs = process.env.GHOSTLY_TEST_PACKAGED_MCP === "1"
    ? [fileURLToPath(new URL("../../cli/dist/assets/mcp-server/index.js", import.meta.url))]
    : ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))];
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: serverArgs, cwd: root, env: { GHOST_TARGET_PROJECT_ROOT: root },
  }));
  const { tools } = await client.listTools();
  assert.equal(tools.find((tool) => tool.name === "ghostly_audit_security")?.annotations?.readOnlyHint, true);

  async function audit(args) {
    const result = await client.callTool({ name: "ghostly_audit_security", arguments: args });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    for (const privateValue of [fixtureValue, root, external, "outside.ts", "oversized.ts", "CHANGE_ME", "export const"]) {
      assert.ok(!text.includes(privateValue));
    }
    return JSON.parse(text);
  }

  const before = await readdir(root, { recursive: true });
  const report = await audit({});
  assert.equal(report.status, "partial");
  assert.ok(report.coverage.skippedFiles >= 1);
  assert.deepEqual(report.findings.map(({ rule, evidence }) => [rule, evidence.file, evidence.line]), [
    ["explicit-root-container-user", "Dockerfile", 2],
    ["dependency-lockfile-not-observed", "package.json", 2],
    ["floating-dependency", "package.json", 3],
    ["possible-embedded-credential", "src/config.ts", 2],
  ]);
  for (const finding of report.findings) {
    assert.ok(["low", "medium", "high"].includes(finding.confidence));
    assert.ok(finding.impact && finding.mitigation);
  }
  assert.deepEqual(await readdir(root, { recursive: true }), before);
  assert.equal(await readFile(sourceFile, "utf8"), source);

  const scoped = await audit({ scope: "src/config.ts" });
  assert.equal(scoped.status, "complete");
  assert.deepEqual(scoped.findings.map(({ evidence }) => evidence.file), ["src/config.ts"]);
  const linkedScopes = hasLink ? ["linked", "linked/outside.ts"] : [];
  for (const scope of ["../outside", ".private", ".env", "node_modules", external, ...linkedScopes]) {
    const rejected = await audit({ scope });
    assert.equal(rejected.status, "unsupported");
    assert.deepEqual(rejected.findings, []);
  }

  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  const locked = await audit({ scope: "package.json" });
  assert.equal(locked.status, "complete");
  assert.deepEqual(locked.findings.map(({ rule }) => rule), ["floating-dependency"]);
  assert.deepEqual(locked.coverage.dependencyManifests, { inspected: 1, withLockfile: 1 });
  assert.equal((await audit({ scope: "package-lock.json" })).status, "unsupported");
});
