import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readAuth, writeAuth } from "../lib/auth.js";
import { checkCursorCliAvailable } from "../lib/llm-check.js";
import { isCliLlmProvider, normalizeLlmProviderId } from "../lib/llm-providers.js";

type ConfigOptions = {
  llmProvider?: string;
  llmModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  clear?: boolean;
};

export function registerConfig(program: Command): void {
  program
    .command("config")
    .description("Configure the AI provider (HTTP API or Cursor CLI) for assisted mode")
    .option("--llm-provider <provider>", "Provider: http, openai, cursor-cli, etc.")
    .option("--llm-model <model>", "LLM model to use")
    .option("--llm-api-key <key>", "LLM provider API key (HTTP only)")
    .option("--llm-base-url <url>", "LLM provider base URL (HTTP only)")
    .option("--clear", "Clear the saved AI configuration")
    .action(async (opts: ConfigOptions) => {
      const current = readAuth();
      if (!current) {
        p.log.error("~/.ghostly/auth.json not found. Run this first: ghostly install");
        process.exit(1);
      }

      if (opts.clear) {
        writeAuth({
          ...current,
          llm: undefined,
        });
        p.outro("AI configuration removed from ~/.ghostly/auth.json");
        return;
      }

      const existingLlm = current.llm ?? {};
      const existingApiKey = existingLlm.apiKey ?? existingLlm.openaiApiKey ?? "";

      const providerChoice =
        opts.llmProvider ??
        (await p.select({
          message: "AI provider for assisted mode",
          options: [
            {
              value: "cursor-cli",
              label: "Cursor Agent CLI",
              hint: "uses local auth (agent login)",
            },
            {
              value: "http",
              label: "HTTP API (OpenAI, Ollama, OpenRouter…)",
              hint: "requires API key and URL",
            },
          ],
          initialValue: isCliLlmProvider(existingLlm.provider)
            ? "cursor-cli"
            : existingLlm.provider
              ? "http"
              : undefined,
        }));
      if (p.isCancel(providerChoice)) process.exit(0);

      const nextProvider = normalizeLlmProviderId(String(providerChoice));
      const useCli = isCliLlmProvider(nextProvider);

      const model =
        opts.llmModel ??
        (await p.text({
          message: "Model",
          placeholder: useCli
            ? "composer-2.5, claude-sonnet-5-thinking-high, etc."
            : "gpt-4o-mini, claude-3-5-sonnet, llama3, etc.",
          initialValue: existingLlm.model ?? (useCli ? "composer-2.5" : ""),
        }));
      if (p.isCancel(model)) process.exit(0);

      let nextApiKey = existingApiKey;
      let nextBaseUrl = existingLlm.baseUrl ?? "";

      if (!useCli) {
        const apiKey =
          opts.llmApiKey ??
          (await p.password({
            message: "Provider API key",
          }));
        if (p.isCancel(apiKey)) process.exit(0);

        const baseUrl =
          opts.llmBaseUrl ??
          (await p.text({
            message: "Chat completions base URL",
            placeholder: existingLlm.baseUrl ?? "https://api.openai.com/v1/chat/completions",
            initialValue: existingLlm.baseUrl ?? "",
          }));
        if (p.isCancel(baseUrl)) process.exit(0);

        nextApiKey = (opts.llmApiKey ?? apiKey).trim() || existingApiKey;
        nextBaseUrl = String(baseUrl).trim();
      } else {
        const check = await checkCursorCliAvailable();
        if (check.ok) {
          p.log.success(`Cursor CLI: ${check.message}`);
        } else {
          p.log.warn(check.message);
          p.log.warn("You can continue; assisted mode will fail until `agent login` works.");
        }
      }

      const nextModel = String(model).trim();

      writeAuth({
        ...current,
        llm: {
          provider: nextProvider,
          ...(nextModel ? { model: nextModel } : {}),
          ...(!useCli && nextApiKey ? { apiKey: nextApiKey } : {}),
          ...(!useCli && nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
        },
      });

      p.outro(
        [
          "AI configuration saved to ~/.ghostly/auth.json",
          `provider: ${nextProvider}`,
          `model: ${nextModel || "(empty)"}`,
          useCli
            ? "auth: Cursor Agent CLI (no API key in auth.json)"
            : `apiKey: ${nextApiKey ? "********" : "(empty)"}`,
          useCli ? "" : `baseUrl: ${nextBaseUrl || "(empty)"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
}
