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
    modelOptions: [
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    ],
  },
];

export function getCatalogEntry(providerId: string): LlmProviderCatalogEntry | undefined {
  return LLM_PROVIDER_CATALOG.find((p) => p.id === providerId);
}
