import { spawn } from "node:child_process";
import { isWindowsCmdScript } from "./resolve-cli-bin.js";

export type CliRunResult = { stdout: string; stderr: string; exitCode: number };

export function runCli(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; stdin?: string },
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    // NUNCA shell:true (C1). Para scripts .cmd/.bat/.ps1 en Windows invocamos
    // cmd.exe /c con el script y sus args como ELEMENTOS SEPARADOS del array,
    // para que Node aplique el quoting por argumento. Así un `model` con `&`
    // llega como un único argv literal, no como operador de shell.
    let file = bin;
    let spawnArgs = args;
    if (isWindowsCmdScript(bin)) {
      file = process.env.ComSpec ?? "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", bin, ...args];
    }
    const child = spawn(file, spawnArgs, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000).unref();
      reject(new Error("timeout"));
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}
