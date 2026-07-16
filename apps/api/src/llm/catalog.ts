export type LlmProviderKind = "cli" | "http";

export type LlmModelOption = { id: string; label: string };

export type LlmProviderCatalogEntry = {
  id: string;
  label: string;
  kind: LlmProviderKind;
  description: string;
  /** ID interno del driver (`cursor-cli` o preset http) */
  driverId: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl?: string;
  defaultModel: string;
  supportsAutoModel: boolean;
  /** Si true, la UI debe pedir modelos vivos vía GET /settings/llm/models */
  supportsLiveModels?: boolean;
  /**
   * Si true, el proveedor acepta contenido multimodal (imágenes) en los
   * mensajes de chat (spec §4.3 — evidencia visual "híbrido según provider").
   * Gatea si el juez adjunta un screenshot al dossier de texto; el dossier de
   * texto SIEMPRE debe autosuficiente, la imagen es solo evidencia extra.
   * Providers CLI (ej. `cursor-cli`, invocados vía stdin de texto plano) NUNCA
   * soportan esto hoy — `false`/ausente por defecto.
   */
  supportsImages?: boolean;
  /** Lista estática o fallback cuando no hay comando live */
  modelOptions: LlmModelOption[];
};

/** Fallback cuando `agent models` falla (Open Design hace lo mismo). */
export const CURSOR_CLI_FALLBACK_MODELS: LlmModelOption[] = [
  { id: "auto", label: "Auto" },
  { id: "composer-2.5", label: "Composer 2.5" },
  { id: "claude-sonnet-5-thinking-high", label: "Sonnet 5 Thinking" },
  { id: "gpt-5.3-codex", label: "Codex 5.3" },
];

export const LLM_PROVIDER_CATALOG: LlmProviderCatalogEntry[] = [
  {
    id: "cursor-cli",
    label: "Cursor Agent CLI",
    kind: "cli",
    driverId: "cursor-cli",
    description: "Usa tu sesión local de Cursor (agent login). Sin API key.",
    needsApiKey: false,
    needsBaseUrl: false,
    defaultModel: "auto",
    supportsAutoModel: true,
    supportsLiveModels: true,
    modelOptions: CURSOR_CLI_FALLBACK_MODELS,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "http",
    driverId: "http",
    description: "API compatible OpenAI Chat Completions.",
    needsApiKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    supportsAutoModel: false,
    supportsImages: true,
    modelOptions: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "http",
    driverId: "http",
    description: "API Mistral (OpenAI-compatible).",
    needsApiKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.mistral.ai/v1/chat/completions",
    defaultModel: "mistral-small-latest",
    supportsAutoModel: false,
    modelOptions: [
      { id: "mistral-small-latest", label: "Mistral Small" },
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "codestral-latest", label: "Codestral" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "http",
    driverId: "http",
    description: "Anthropic vía proxy OpenAI-compatible (OpenRouter, LiteLLM, etc.).",
    needsApiKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "anthropic/claude-sonnet-4",
    supportsAutoModel: false,
    supportsImages: true,
    modelOptions: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "http",
    driverId: "http",
    description: "Modelo local vía Ollama.",
    needsApiKey: false,
    needsBaseUrl: true,
    defaultBaseUrl: "http://127.0.0.1:11434/v1/chat/completions",
    defaultModel: "llama3",
    supportsAutoModel: false,
    modelOptions: [{ id: "llama3", label: "Llama 3" }],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "http",
    driverId: "http",
    description: "Agregador multi-modelo.",
    needsApiKey: true,
    needsBaseUrl: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
    supportsAutoModel: false,
    supportsImages: true,
    modelOptions: [
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    ],
  },
];

export function getCatalogEntry(providerId: string): LlmProviderCatalogEntry | undefined {
  return LLM_PROVIDER_CATALOG.find((p) => p.id === providerId);
}

/**
 * Charset seguro para el campo `model` (C1): solo alfanuméricos y `._:/-`, sin
 * espacios ni metacaracteres de shell, primer carácter alfanumérico (rechaza
 * argument-injection tipo `--flag`, CWE-88), máx 64 chars. Este regex es el
 * control de seguridad: neutraliza tanto la inyección de comandos como la de
 * argumentos independientemente del proveedor.
 */
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

/**
 * Allow-list del campo `model` en la frontera de entrada (PUT /v1/settings/llm).
 * - Siempre exige `SAFE_MODEL` (mata inyección de comandos/argumentos).
 * - Proveedores con catálogo estático: además el id debe estar en el catálogo.
 * - Proveedores con `supportsLiveModels` (ej. cursor-cli): el catálogo vivo puede
 *   crecer, así que basta el charset seguro (no hay lista estática exhaustiva).
 */
export function isModelAllowed(catalog: LlmProviderCatalogEntry, model: string): boolean {
  const m = model.trim();
  if (!SAFE_MODEL.test(m)) return false;
  if (catalog.supportsLiveModels) return true;
  const staticIds = new Set<string>([
    catalog.defaultModel,
    ...catalog.modelOptions.map((o) => o.id),
  ]);
  return staticIds.has(m);
}

/**
 * Gating de capacidad de imágenes por provider (spec §4.3 — evidencia visual
 * "híbrido según provider"). Providers desconocidos (no catalogados, ej. un
 * CLI agent custom) se tratan como NO soportan imágenes por defecto — el
 * mismo sesgo conservador que el resto del contrato del juez: en la duda, no
 * asumas capacidad extra.
 */
export function providerSupportsImages(providerId: string): boolean {
  return getCatalogEntry(providerId)?.supportsImages === true;
}
