import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import DESPUÉS del mock (vi.mock está hoisted).
const { CliLlmProvider } = await import("./cli.js");
const { CLI_AGENT_REGISTRY } = await import("./cli-registry.js");

function makeFakeChild(stdoutLine: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; end: () => void };
    kill: () => void;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.kill = () => {};
  child.killed = false;
  queueMicrotask(() => {
    child.stdout.emit("data", stdoutLine);
    child.emit("close", 0);
  });
  return child;
}

const def = CLI_AGENT_REGISTRY["cursor-cli"]!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = {
  providerId: "cursor-cli",
  model: "composer-2.5",
  cliBin: "agent",
  // Simula el comportamiento previo: cwd = raíz del repo. El fix DEBE ignorarlo.
  cliWorkspace: process.cwd(),
} as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = {
  messages: [{ role: "user", content: "hola" }],
  timeoutMs: 1000,
} as any;

afterEach(() => {
  spawnMock.mockReset();
});

describe("CliLlmProvider.complete (IA-2.2 — workspace efímero, no la raíz del repo)", () => {
  it("lanza el agente en un tmpdir efímero, NO en la raíz del monorepo", async () => {
    const envelope = JSON.stringify({ result: "{\"ok\":true}", is_error: false });
    spawnMock.mockImplementation(() => makeFakeChild(envelope));

    const provider = new CliLlmProvider(config, def);
    await provider.complete(req);

    const cwd = spawnMock.mock.calls[0]?.[2] as { cwd?: string };
    expect(cwd.cwd).toBeDefined();
    expect(cwd.cwd).not.toBe(process.cwd());
    expect(cwd.cwd).not.toBe(config.cliWorkspace);
    // Bajo el directorio temporal del SO.
    expect(cwd.cwd!.startsWith(tmpdir())).toBe(true);
  });
});
