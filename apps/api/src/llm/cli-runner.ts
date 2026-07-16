import { spawn } from "node:child_process";
import { isWindowsCmdScript } from "./resolve-cli-bin.js";

export type CliRunResult = { stdout: string; stderr: string; exitCode: number };

/**
 * Allowlist EXPLÍCITA de variables de entorno heredadas por el proceso hijo del
 * CLI (IA-2.4). El provider `cursor-cli` no lanza un modelo pasivo: lanza un
 * AGENTE DE CÓDIGO con acceso al host. Heredar todo `process.env` le expondría
 * cada secreto del entorno del dev (JWT_SECRET, OPENAI_API_KEY, CURSOR_API_KEY,
 * DATABASE_URL, la Ghostly API key…), exfiltrables por el canal legítimo del
 * `result`/`rationale` que Ghostly parsea y persiste. NUNCA se hace
 * `{ ...process.env }`: solo se pasa lo mínimo para que el binario arranque y
 * encuentre su sesión/credenciales.
 *   - PATH / PATHEXT: resolución del ejecutable y de scripts en Windows.
 *   - SystemRoot / ComSpec: requeridos por spawn en Windows (cmd.exe + DLLs base);
 *     sin ellos el propio arranque del proceso hijo falla.
 *   - LOCALAPPDATA / APPDATA / USERPROFILE / HOMEDRIVE / HOMEPATH: dónde
 *     cursor-agent guarda su sesión/auth en Windows (mismo LOCALAPPDATA que usa
 *     resolve-cli-bin para localizar el .cmd).
 *   - HOME: idem en POSIX.
 *   - TEMP / TMP: directorio temporal del binario.
 *   - CURSOR_API_KEY: credencial propia del provider (bypass de login interactivo).
 * Los nombres solo-Windows son inertes en POSIX (no existen en process.env) y
 * viceversa, así que una sola lista sirve cross-platform.
 */
const CLI_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "ComSpec",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "TEMP",
  "TMP",
  "CURSOR_API_KEY",
] as const;

function buildCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CLI_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

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
      env: buildCliEnv(),
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
