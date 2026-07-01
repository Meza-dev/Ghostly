import { isCliProviderId, type ResolvedLlmConfig } from "./config.js";
import { CliLlmProvider } from "./providers/cli.js";
import { CLI_AGENT_REGISTRY } from "./providers/cli-registry.js";
import { HttpOpenAiProvider } from "./providers/http-openai.js";
import type { LlmProvider } from "./types.js";

export function createLlmProvider(config: ResolvedLlmConfig): LlmProvider | null {
  if (isCliProviderId(config.providerId)) {
    const def = CLI_AGENT_REGISTRY[config.providerId];
    if (!def) return null;
    return new CliLlmProvider(config, def);
  }
  if (config.endpoint && config.apiKey) {
    return new HttpOpenAiProvider(config);
  }
  return null;
}
