import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isCliLlmProvider } from "./llm-providers.js";

function resolveCursorAgentBin(): string {
  const fromEnv = process.env.CURSOR_AGENT_BIN?.trim();
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) {
      const cmd = join(localAppData, "cursor-agent", "cursor-agent.cmd");
      if (existsSync(cmd)) return cmd;
    }
  }
  return "agent";
}

function needsShell(bin: string): boolean {
  if (process.platform !== "win32") return false;
  if (bin.endsWith(".cmd") || bin.endsWith(".bat")) return true;
  return bin === "agent";
}

function runCli(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, shell: needsShell(bin), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += String(c); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`exit ${code}`));
    });
  });
}

/** Comprueba que `agent` esté instalado y autenticado (o CURSOR_API_KEY definida). */
export async function checkCursorCliAvailable(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (process.env.CURSOR_API_KEY?.trim()) {
    return { ok: true, message: "CURSOR_API_KEY configurada" };
  }
  const bin = resolveCursorAgentBin();
  try {
    await runCli(bin, ["--version"], 5_000);
  } catch {
    return {
      ok: false,
      message: `No se encontró '${bin}'. Instala Cursor Agent CLI o define CURSOR_AGENT_BIN.`,
    };
  }
  try {
    const stdout = await runCli(bin, ["status"], 8_000);
    if (/logged in|✓/i.test(stdout)) {
      return { ok: true, message: stdout.trim() };
    }
    return { ok: false, message: "Cursor Agent no autenticado. Ejecuta: agent login" };
  } catch {
    return { ok: false, message: "No se pudo verificar la sesión de Cursor Agent (agent status)" };
  }
}

export function isAssistLlmConfigured(auth: {
  llm?: { provider?: string; apiKey?: string; openaiApiKey?: string };
}): boolean {
  const provider = auth.llm?.provider;
  if (isCliLlmProvider(provider)) return true;
  return Boolean(auth.llm?.apiKey || auth.llm?.openaiApiKey);
}
