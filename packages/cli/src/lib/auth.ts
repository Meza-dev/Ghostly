import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { getAuthFile } from "./paths.js";

export type LlmConfig = {
  /** Nombre del modelo, ej. "gpt-4o", "claude-3-5-sonnet", "llama3" */
  model?: string;
  /** API Key del proveedor LLM (agnóstico al vendor) */
  apiKey?: string;
  /** Compatibilidad con versiones previas del auth.json */
  openaiApiKey?: string;
  /** Base URL personalizada (Ollama, Azure OpenAI, OpenRouter, etc.) */
  baseUrl?: string;
  /** Proveedor explícito, ej. "openai", "anthropic", "ollama" */
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

export type KeygenMode = "uuid" | "token";

export function generateApiKey(mode: KeygenMode = "uuid"): string {
  if (mode === "uuid") {
    return randomUUID();
  }
  return randomBytes(32).toString("hex");
}

/** Convierte GhostAuth en el mapa de env vars que se inyecta al proceso de la API. */
export function authToEnv(auth: GhostAuth): Record<string, string> {
  const env: Record<string, string> = {
    GHOST_API_KEY: auth.apiKey,
    GHOST_API_URL: auth.apiUrl,
  };

  if (auth.llm) {
    if (auth.llm.model) env["LLM_MODEL"] = auth.llm.model;
    const llmApiKey = auth.llm.apiKey ?? auth.llm.openaiApiKey;
    if (llmApiKey) {
      // Variable genérica usada por el backend Assist.
      env["ASSIST_LLM_API_KEY"] = llmApiKey;
      // Compatibilidad hacia atrás con implementaciones que esperan OPENAI_API_KEY.
      env["OPENAI_API_KEY"] = llmApiKey;
    }
    if (auth.llm.baseUrl) env["LLM_BASE_URL"] = auth.llm.baseUrl;
    if (auth.llm.provider) env["LLM_PROVIDER"] = auth.llm.provider;
  }

  if (auth.extraEnv) {
    for (const [k, v] of Object.entries(auth.extraEnv)) {
      env[k] = v;
    }
  }

  return env;
}
