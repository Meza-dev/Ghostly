import { CLI_AGENT_REGISTRY } from "./providers/cli-registry.js";
import { getRequestLlmConfig } from "./context.js";
import { resolveCliBin, resolveDefaultCliWorkspace } from "./resolve-cli-bin.js";

export type ResolvedLlmConfig = {
  /** `http` o id de CLI registrado (ej. `cursor-cli`) */
  providerId: string;
  model: string;
  endpoint: string;
  apiKey: string;
  cliBin: string;
  cliWorkspace: string;
  defaultTimeoutMs: number;
};

function parseIntOr(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeProviderId(raw: string | undefined): string {
  const value = (raw ?? "http").trim().toLowerCase();
  if (value === "cursor" || value === "cursor-cli") return "cursor-cli";
  if (value in CLI_AGENT_REGISTRY) return value;
  return "http";
}

export function isCliProviderId(providerId: string): boolean {
  return providerId in CLI_AGENT_REGISTRY;
}

/** Fallback cuando no hay preferencias de usuario en la request. */
export function resolveLlmConfigFromEnv(): ResolvedLlmConfig {
  const providerId = normalizeProviderId(
    process.env.ASSIST_LLM_PROVIDER?.trim() || process.env.LLM_PROVIDER?.trim(),
  );
  const cliDef = CLI_AGENT_REGISTRY[providerId];

  return {
    providerId,
    model:
      process.env.ASSIST_LLM_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      (cliDef?.defaultModel ?? "assist-fallback-v1"),
    endpoint:
      process.env.ASSIST_LLM_API_URL?.trim() ||
      process.env.LLM_BASE_URL?.trim() ||
      "",
    apiKey:
      process.env.ASSIST_LLM_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      "",
    cliBin: resolveCliBin(providerId, cliDef?.defaultBin ?? "agent"),
    cliWorkspace: resolveDefaultCliWorkspace(),
    defaultTimeoutMs: parseIntOr(process.env.ASSIST_LLM_TIMEOUT_MS, 45_000),
  };
}

export function resolveLlmConfig(): ResolvedLlmConfig {
  return getRequestLlmConfig() ?? resolveLlmConfigFromEnv();
}
