import { CURSOR_CLI_FALLBACK_MODELS, type LlmModelOption } from "./catalog.js";
import { runCli } from "./cli-runner.js";
import type { ResolvedLlmConfig } from "./config.js";

export type CliModelsListResult = {
  models: LlmModelOption[];
  source: "live" | "fallback";
  message?: string;
};

/** Parsea salida de `agent models` (formato `id - label`, estilo Open Design). */
export function parseCursorModelsOutput(stdout: string): LlmModelOption[] {
  const models: LlmModelOption[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Available models" || trimmed.startsWith("Tip:")) continue;
    const dash = trimmed.indexOf(" - ");
    if (dash === -1) continue;
    const id = trimmed.slice(0, dash).trim();
    const label = trimmed.slice(dash + 3).trim();
    if (!id || id === "Available models") continue;
    models.push({ id, label });
  }
  return models;
}

const CACHE_TTL_MS = 60_000;
let cached: { key: string; at: number; result: CliModelsListResult } | null = null;

export async function listCursorCliModels(
  config: ResolvedLlmConfig,
): Promise<CliModelsListResult> {
  const cacheKey = `${config.cliBin}:${config.cliWorkspace}`;
  if (cached && cached.key === cacheKey && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  const cwd = config.cliWorkspace;
  try {
    const { stdout, stderr, exitCode } = await runCli(
      config.cliBin,
      ["models", "--trust"],
      { cwd, timeoutMs: 15_000 },
    );
    const parsed = parseCursorModelsOutput(stdout);
    if (parsed.length > 0) {
      const result: CliModelsListResult = { models: parsed, source: "live" };
      cached = { key: cacheKey, at: Date.now(), result };
      return result;
    }
    const hint = (stderr || stdout).trim().slice(0, 200);
    const result: CliModelsListResult = {
      models: CURSOR_CLI_FALLBACK_MODELS,
      source: "fallback",
      message: hint || `agent models terminó con código ${exitCode}`,
    };
    cached = { key: cacheKey, at: Date.now(), result };
    return result;
  } catch (error) {
    const result: CliModelsListResult = {
      models: CURSOR_CLI_FALLBACK_MODELS,
      source: "fallback",
      message: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}
