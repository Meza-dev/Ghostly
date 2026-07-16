import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import DESPUÉS del mock (vi.mock está hoisted).
const { runCli } = await import("./cli-runner.js");

const onWin = process.platform === "win32";

function makeFakeChild() {
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
  queueMicrotask(() => child.emit("close", 0));
  return child;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe("runCli (C1 — spawn nunca con shell:true; sin interpretación de metacaracteres)", () => {
  it("NUNCA invoca spawn con shell:true, ni siquiera para 'agent'", async () => {
    spawnMock.mockImplementation(() => makeFakeChild());
    await runCli("agent", ["--model", "auto & whoami"], { cwd: ".", timeoutMs: 1000 });
    const opts = spawnMock.mock.calls[0]?.[2] as { shell?: boolean };
    expect(opts.shell).toBe(false);
  });

  it("el payload con metacaracteres viaja como UN argv literal (no como operador de shell)", async () => {
    spawnMock.mockImplementation(() => makeFakeChild());
    await runCli("agent", ["--model", "auto & whoami"], { cwd: ".", timeoutMs: 1000 });
    const args = spawnMock.mock.calls[0]?.[1] as string[];
    // El '& whoami' permanece embebido en un único elemento del array argv.
    expect(args).toContain("auto & whoami");
  });

  it.skipIf(!onWin)(
    "en Windows envuelve un .cmd con cmd.exe y args SEPARADOS (windowsVerbatimArguments=false)",
    async () => {
      spawnMock.mockImplementation(() => makeFakeChild());
      await runCli("C:/x/cursor-agent.cmd", ["--model", "auto"], { cwd: ".", timeoutMs: 1000 });
      const [file, args, opts] = spawnMock.mock.calls[0] as [string, string[], { shell?: boolean }];
      expect(opts.shell).toBe(false);
      expect(String(file).toLowerCase()).toContain("cmd.exe");
      expect(args).toEqual(["/d", "/s", "/c", "C:/x/cursor-agent.cmd", "--model", "auto"]);
    },
  );

  it.skipIf(onWin)("en POSIX invoca el binario directo sin envoltura", async () => {
    spawnMock.mockImplementation(() => makeFakeChild());
    await runCli("agent", ["--model", "auto"], { cwd: ".", timeoutMs: 1000 });
    const [file, args, opts] = spawnMock.mock.calls[0] as [string, string[], { shell?: boolean }];
    expect(opts.shell).toBe(false);
    expect(file).toBe("agent");
    expect(args).toEqual(["--model", "auto"]);
  });
});

describe("runCli (IA-2.4 — allowlist de entorno; NUNCA hereda todo process.env)", () => {
  it("NO propaga secretos del entorno al proceso hijo del agente", async () => {
    process.env.SECRET_TEST_LEAK = "leak-me";
    process.env.JWT_SECRET = "super-secret";
    try {
      spawnMock.mockImplementation(() => makeFakeChild());
      await runCli("agent", ["--model", "auto"], { cwd: ".", timeoutMs: 1000 });
      const env = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
      expect(env.env).toBeDefined();
      expect(env.env).not.toHaveProperty("SECRET_TEST_LEAK");
      expect(env.env).not.toHaveProperty("JWT_SECRET");
    } finally {
      delete process.env.SECRET_TEST_LEAK;
      delete process.env.JWT_SECRET;
    }
  });

  it("SÍ propaga PATH y la credencial propia del provider (CURSOR_API_KEY)", async () => {
    process.env.PATH = process.env.PATH ?? "/usr/bin";
    process.env.CURSOR_API_KEY = "cursor-token";
    try {
      spawnMock.mockImplementation(() => makeFakeChild());
      await runCli("agent", ["--model", "auto"], { cwd: ".", timeoutMs: 1000 });
      const env = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
      expect(env.env?.PATH).toBeDefined();
      expect(env.env?.CURSOR_API_KEY).toBe("cursor-token");
    } finally {
      delete process.env.CURSOR_API_KEY;
    }
  });
});
