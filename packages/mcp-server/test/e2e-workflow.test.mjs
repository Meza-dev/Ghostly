import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { createServer } = await import(new URL(
  "../../../apps/playground/node_modules/vite/dist/node/index.js", import.meta.url,
).href);
const { chromium } = await import(new URL("../../cli/node_modules/playwright/index.mjs", import.meta.url).href);
const execFileAsync = promisify(execFile);

const flow = {
  name: "client-persistence",
  route: "/login",
  steps: [
    { action: "fill", testId: "login-user", value: "fixture-user" },
    { action: "fill", testId: "login-password", value: "fixture-password" },
    { action: "click", testId: "login-submit" },
    { action: "click", testId: "cliente-crear" },
    { action: "fill", testId: "cliente-form-nombre", value: "Ghostly Persistence Fixture {{runId}}" },
    { action: "click", testId: "cliente-form-guardar" },
  ],
  acknowledgement: { testId: "toast", text: "Cliente creado con éxito." },
  persistence: { testId: "clientes-table", text: "Ghostly Persistence Fixture {{runId}}" },
};

test("MCP freezes one browser test against three actual Playground variants", async (t) => {
  const workspace = await mkdtemp(fileURLToPath(new URL("../../cli/e2e-fixture-", import.meta.url)));
  const client = new Client({ name: "ghostly-e2e-fixture", version: "1.0.0" });
  const servers = [];
  t.after(async () => {
    await client.close();
    await Promise.all(servers.map((close) => close()));
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });
  await mkdir(path.join(workspace, "test"));
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({
    type: "module",
    scripts: { test: "tsx --test test/*.test.ts" },
    devDependencies: { playwright: "^1.59.1", tsx: "^4.0.0" },
  }));
  const env = { GHOST_TARGET_PROJECT_ROOT: workspace };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const entry = process.env.GHOSTLY_TEST_PACKAGED_MCP === "1"
    ? [fileURLToPath(new URL("../../cli/dist/assets/mcp-server/index.js", import.meta.url))]
    : ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))];
  await client.connect(new StdioClientTransport({ command: process.execPath, args: entry, cwd: workspace, env }));
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "ghostly_test_e2e"));

  async function start(alternate) {
    const server = await createServer({
      root: fileURLToPath(new URL("../../../apps/playground/", import.meta.url)),
      define: { "import.meta.env.VITE_PLAYGROUND_LAYOUT_VARIANT": JSON.stringify(alternate ? "alternate" : "default") },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    });
    const listener = createHttpServer(server.middlewares);
    servers.push(async () => {
      await new Promise((resolve) => listener.close(resolve));
      await server.close();
    });
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    return `http://127.0.0.1:${listener.address().port}`;
  }
  async function invoke(name, args) {
    const result = await client.callTool({
      name,
      arguments: args,
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  const call = (mode, baseUrl) => invoke("ghostly_test_e2e", { mode, baseUrl, ...flow });
  async function reset(baseUrl) {
    assert.ok((await fetch(`${baseUrl}/api/reset`, { method: "POST" })).ok);
  }
  async function withClientsPage(baseUrl, inspect) {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/login`);
      await page.getByTestId("login-user").fill("fixture-user");
      await page.getByTestId("login-password").fill("fixture-password");
      await page.getByTestId("login-submit").click();
      await inspect(page);
    } finally {
      await browser.close();
    }
  }

  const healthy = await start(false);
  const testFile = "test/client-persistence.ghostly.e2e.test.ts";
  const absolute = path.join(workspace, testFile);
  const plan = await call("plan", healthy);
  assert.equal(plan.status, "planned", JSON.stringify(plan));
  assert.equal(plan.testFile, testFile);
  assert.deepEqual(plan.changedFiles, []);
  await assert.rejects(readFile(absolute), { code: "ENOENT" });
  const unbound = await invoke("ghostly_test_e2e", {
    mode: "plan", baseUrl: healthy, ...flow,
    persistence: { ...flow.persistence, text: "Other fixture {{runId}}" },
  });
  assert.equal(unbound.status, "unsupported");

  const request = { testType: "e2e", e2e: { baseUrl: healthy, ...flow } };
  const brief = await invoke("ghostly_init", { mode: "plan", ...request });
  assert.equal(brief.status, "ready", JSON.stringify(brief));
  assert.deepEqual(brief.options[0].plannedFiles, [testFile]);
  const approval = { mode: "apply", selection: "A", planToken: brief.planToken };
  const changedRoute = await invoke("ghostly_init", {
    ...approval, ...request, e2e: { ...request.e2e, route: "/clientes" },
  });
  assert.equal(changedRoute.status, "plan_changed");
  await assert.rejects(readFile(absolute), { code: "ENOENT" });

  await reset(healthy);
  const passed = await invoke("ghostly_init", { ...approval, ...request });
  assert.equal(passed.status, "passed", JSON.stringify(passed));
  assert.equal(passed.selection, "A");
  assert.deepEqual(passed.changedFiles, [testFile]);
  const frozen = await readFile(absolute, "utf8");
  assert.ok(!frozen.includes(healthy));
  assert.match(frozen, /process\.env\.GHOSTLY_E2E_BASE_URL/);
  assert.match(frozen, /const runId = randomUUID\(\)/);

  const clients = await (await fetch(`${healthy}/api/clientes`)).json();
  const oldRecord = clients.find(({ nombre }) => /^Ghostly Persistence Fixture [a-f0-9-]{36}$/.test(nombre));
  assert.ok(oldRecord, "The first test must leave a runtime-generated record behind");
  const config = await fetch(`${healthy}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonPersistingSave: true }),
  });
  assert.ok(config.ok);
  const failed = await call("apply", healthy);
  assert.equal(failed.status, "failed", JSON.stringify(failed));
  assert.match(failed.verification.output, /PERSISTENCE_ASSERTION/);
  assert.match(failed.verification.output, /ERR_ASSERTION/);
  assert.deepEqual(failed.changedFiles, []);
  assert.equal(await readFile(absolute, "utf8"), frozen);
  await withClientsPage(healthy, async (page) => {
    await page.getByTestId("clientes-table").getByText(oldRecord.nombre, { exact: true }).waitFor({ state: "visible" });
  });

  const alternate = await start(true);
  await reset(alternate);
  await withClientsPage(alternate, async (page) => {
    assert.equal(await page.getByTestId("cliente-crear").textContent(), "Agregar cliente");
  });
  const changedUi = await call("apply", alternate);
  assert.equal(changedUi.status, "passed", JSON.stringify(changedUi));
  assert.deepEqual(changedUi.changedFiles, []);
  assert.equal(await readFile(absolute, "utf8"), frozen);

  await reset(alternate);
  const replayEnv = { ...process.env, GHOSTLY_E2E_BASE_URL: alternate };
  delete replayEnv.NODE_TEST_CONTEXT;
  const replay = await execFileAsync(process.execPath, ["--import", "tsx", "--test", testFile], {
    cwd: workspace, env: replayEnv, encoding: "utf8", timeout: 30_000,
  }).catch((error) => {
    assert.fail([error.message, error.stdout, error.stderr].filter(Boolean).join("\n"));
  });
  assert.match(replay.stdout, /client-persistence/);
});
