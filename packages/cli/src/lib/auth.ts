import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { getAuthFile } from "./paths.js";
import { isCliLlmProvider, normalizeLlmProviderId } from "./llm-providers.js";

export type LlmConfig = {
  /** Nombre del modelo, ej. "gpt-4o", "claude-3-5-sonnet", "llama3" */
  model?: string;
  /** API Key del proveedor LLM (agnóstico al vendor) */
  apiKey?: string;
  /** Compatibilidad con versiones previas del auth.json */
  openaiApiKey?: string;
  /** Base URL personalizada (Ollama, Azure OpenAI, OpenRouter, etc.) */
  baseUrl?: string;
  /** Proveedor explícito: `http`, `openai`, `cursor-cli`, etc. */
  provider?: string;
};

export type GhostAuth = {
  /** API Key de Ghostly (GHOST_API_KEY) */
  apiKey: string;
  /** URL del backend local (GHOST_API_URL) */
  apiUrl: string;
  /** Config del LLM que usa el backend para Assist */
  llm?: LlmConfig;
  /**
   * Variables de entorno adicionales que se inyectarán al proceso del API.
   * Útil para proveedores alternativos, proxies, feature flags, etc.
   */
  extraEnv?: Record<string, string>;
};

export function readAuth(): GhostAuth | null {
  const path = getAuthFile();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GhostAuth;
  } catch {
    return null;
  }
}

export function writeAuth(auth: GhostAuth): void {
  writeFileSync(getAuthFile(), JSON.stringify(auth, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export type KeygenMode = "secure" | "uuid" | "token";

/**
 * Genera la API key de Ghostly. Default `secure`: prefijo `gk_` + 32 bytes
 * aleatorios en base64url (URL-safe, alta entropía). Los modos `uuid`/`token`
 * quedan por compatibilidad — las keys viejas (uuid) siguen validando porque
 * el servidor compara por igualdad exacta, no por formato.
 */
export function generateApiKey(mode: KeygenMode = "secure"): string {
  if (mode === "uuid") {
    return randomUUID();
  }
  if (mode === "token") {
    return randomBytes(32).toString("hex");
  }
  return `gk_${randomBytes(32).toString("base64url")}`;
}

/**
 * Garantiza un JWT_SECRET fuerte y estable para el proceso de la API. Lo genera
 * y persiste en auth.json (extraEnv) la primera vez, para que `ghostly up`
 * arranque sin que el usuario tenga que definir nada (guard C2 del API).
 * Estable entre reinicios: los tokens ya emitidos siguen siendo válidos.
 */
export function ensureJwtSecret(auth: GhostAuth): string {
  const existing = auth.extraEnv?.JWT_SECRET?.trim();
  if (existing && existing.length >= 32) return existing;
  const secret = randomBytes(48).toString("base64url"); // ~64 chars, > mínimo de 32
  auth.extraEnv = { ...auth.extraEnv, JWT_SECRET: secret };
  writeAuth(auth);
  return secret;
}

/** Convierte GhostAuth en el mapa de env vars que se inyecta al proceso de la API. */
export function authToEnv(auth: GhostAuth): Record<string, string> {
  const env: Record<string, string> = {
    GHOST_API_KEY: auth.apiKey,
    GHOST_API_URL: auth.apiUrl,
  };

  if (auth.llm) {
    const provider = auth.llm.provider?.trim();
    if (provider) {
      const normalized = normalizeLlmProviderId(provider);
      env["ASSIST_LLM_PROVIDER"] = normalized;
      env["LLM_PROVIDER"] = normalized;
    }
    if (auth.llm.model) {
      env["ASSIST_LLM_MODEL"] = auth.llm.model;
      env["LLM_MODEL"] = auth.llm.model;
    }

    const useCli = isCliLlmProvider(provider);
    if (!useCli) {
      const llmApiKey = auth.llm.apiKey ?? auth.llm.openaiApiKey;
      if (llmApiKey) {
        env["ASSIST_LLM_API_KEY"] = llmApiKey;
        env["OPENAI_API_KEY"] = llmApiKey;
      }
      if (auth.llm.baseUrl) {
        env["ASSIST_LLM_API_URL"] = auth.llm.baseUrl;
        env["LLM_BASE_URL"] = auth.llm.baseUrl;
      }
    }
  }

  if (auth.extraEnv) {
    for (const [k, v] of Object.entries(auth.extraEnv)) {
      env[k] = v;
    }
  }

  return env;
}
