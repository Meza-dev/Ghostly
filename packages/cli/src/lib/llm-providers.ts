/** Proveedores CLI registrados en el API (apps/api/src/llm/providers/cli-registry.ts) */
export const CLI_LLM_PROVIDER_IDS = ["cursor-cli"] as const;

export type CliLlmProviderId = (typeof CLI_LLM_PROVIDER_IDS)[number];

export function isCliLlmProvider(provider: string | undefined): boolean {
  if (!provider) return false;
  const normalized = provider.trim().toLowerCase();
  return normalized === "cursor" || CLI_LLM_PROVIDER_IDS.includes(normalized as CliLlmProviderId);
}

export function normalizeLlmProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "cursor") return "cursor-cli";
  return normalized;
}
