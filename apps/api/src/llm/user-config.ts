import { createLlmProvider } from "./factory.js";
import { getCatalogEntry } from "./catalog.js";
import { resolveLlmConfigFromEnv } from "./config.js";
import type { ResolvedLlmConfig } from "./config.js";
import { CLI_AGENT_REGISTRY } from "./providers/cli-registry.js";
import { resolveCliBin, resolveDefaultCliWorkspace } from "./resolve-cli-bin.js";
import type { UserLlmSettingsRecord } from "../store/llm-settings.js";
import { msg, type Lang } from "../i18n/pick.js";

function parseIntOr(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function settingsToResolvedConfig(
  settings: UserLlmSettingsRecord | null,
): ResolvedLlmConfig {
  if (!settings) return resolveLlmConfigFromEnv();

  const catalog = getCatalogEntry(settings.providerId);
  const driverId = catalog?.driverId ?? settings.providerId;
  const cliDef = CLI_AGENT_REGISTRY[driverId];

  return {
    providerId: driverId,
    model: settings.model || catalog?.defaultModel || "assist-fallback-v1",
    endpoint: settings.baseUrl?.trim() || catalog?.defaultBaseUrl || "",
    apiKey: settings.apiKey?.trim() || "",
    cliBin: resolveCliBin(driverId, cliDef?.defaultBin ?? "agent"),
    cliWorkspace: resolveDefaultCliWorkspace(),
    defaultTimeoutMs: parseIntOr(process.env.ASSIST_LLM_TIMEOUT_MS, 45_000),
  };
}

export type LlmStatus = {
  available: boolean;
  providerId: string;
  model: string;
  source: "user" | "env" | "none";
  cursorCli?: {
    installed: boolean;
    loggedIn: boolean;
    message: string;
  };
};

export async function getLlmStatus(
  config: ResolvedLlmConfig,
  source: LlmStatus["source"] = "env",
  lang: Lang = "en",
): Promise<LlmStatus> {
  const provider = createLlmProvider(config);
  const catalog = getCatalogEntry(
    config.providerId === "cursor-cli" ? "cursor-cli" : inferCatalogId(config),
  );

  let cursorCli: LlmStatus["cursorCli"];
  if (config.providerId === "cursor-cli") {
    cursorCli = await probeCursorCli(config, lang);
  }

  return {
    available: provider ? await provider.isAvailable() : false,
    providerId: catalog?.id ?? config.providerId,
    model: config.model,
    source,
    ...(cursorCli ? { cursorCli } : {}),
  };
}

function inferCatalogId(config: ResolvedLlmConfig): string {
  if (config.endpoint.includes("mistral.ai")) return "mistral";
  if (config.endpoint.includes("openrouter.ai")) return "openrouter";
  if (config.endpoint.includes("11434")) return "ollama";
  if (config.endpoint.includes("openai.com")) return "openai";
  return "openai";
}

async function probeCursorCli(
  config: ResolvedLlmConfig,
  lang: Lang,
): Promise<NonNullable<LlmStatus["cursorCli"]>> {
  if (process.env.CURSOR_API_KEY?.trim()) {
    return {
      installed: true,
      loggedIn: true,
      message: msg("llm.cursorApiKeyConfigured", lang),
    };
  }
  const provider = createLlmProvider(config);
  if (!provider) {
    return { installed: false, loggedIn: false, message: msg("llm.cursorCliNotConfigured", lang) };
  }
  const available = await provider.isAvailable();
  return {
    installed: available,
    loggedIn: available,
    message: available
      ? msg("llm.cursorCliReady", lang)
      : msg("llm.cursorCliInstallHint", lang, { cliBin: config.cliBin }),
  };
}

export function maskApiKey(apiKey?: string | null): { configured: boolean; hint?: string } {
  if (!apiKey?.trim()) return { configured: false };
  const k = apiKey.trim();
  return { configured: true, hint: `${k.slice(0, 4)}••••${k.slice(-4)}` };
}
