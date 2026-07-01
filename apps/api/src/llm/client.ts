import { resolveLlmConfig } from "./config.js";
import { extractJsonBlock } from "./extract-json.js";
import { createLlmProvider } from "./factory.js";
import type { LlmMessage } from "./types.js";

export type CompleteJsonOptions = {
  timeoutMs: number;
  label?: string;
  model?: string;
};

function isDebugEnabled(): boolean {
  const raw = (process.env.ASSIST_LLM_DEBUG ?? "").trim().toLowerCase();
  if (raw === "") return process.env.NODE_ENV !== "production";
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function debugLog(label: string, data: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[assist-llm:${label}] ${JSON.stringify(data)}`);
}

let cachedProvider: { key: string; provider: ReturnType<typeof createLlmProvider> } | null = null;

export function invalidateLlmProviderCache(): void {
  cachedProvider = null;
}

function getProvider() {
  const config = resolveLlmConfig();
  const key = JSON.stringify(config);
  if (!cachedProvider || cachedProvider.key !== key) {
    cachedProvider = { key, provider: createLlmProvider(config) };
  }
  return { config, provider: cachedProvider.provider };
}

export async function isLlmConfigured(): Promise<boolean> {
  const { provider } = getProvider();
  if (!provider) return false;
  return provider.isAvailable();
}

export function getLlmDisplayModel(): string {
  return resolveLlmConfig().model;
}

export function getLlmProviderId(): string {
  return resolveLlmConfig().providerId;
}

/** @returns objeto vacío si no hay proveedor o no está disponible */
export async function completeJson(
  messages: LlmMessage[],
  opts: CompleteJsonOptions,
): Promise<Record<string, unknown>> {
  const { config, provider } = getProvider();
  const label = opts.label ?? "llm";

  if (!provider) {
    debugLog(label, { stage: "skip", reason: "no_provider", providerId: config.providerId });
    return {};
  }

  const available = await provider.isAvailable();
  if (!available) {
    debugLog(label, {
      stage: "skip",
      reason: "unavailable",
      providerId: provider.providerId,
    });
    return {};
  }

  const startedAt = Date.now();
  debugLog(label, {
    stage: "request",
    providerId: provider.providerId,
    model: opts.model ?? config.model,
    timeoutMs: opts.timeoutMs,
    systemChars: messages.find((m) => m.role === "system")?.content.length ?? 0,
    userChars: messages.find((m) => m.role === "user")?.content.length ?? 0,
  });

  const result = await provider.complete({
    messages,
    timeoutMs: opts.timeoutMs,
    label,
    model: opts.model ?? config.model,
    jsonMode: true,
  });

  debugLog(label, {
    stage: "response",
    providerId: result.providerId,
    elapsedMs: Date.now() - startedAt,
    usage: result.usage ?? null,
    rawContent: result.rawText,
  });

  const parsed = JSON.parse(extractJsonBlock(result.rawText)) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
