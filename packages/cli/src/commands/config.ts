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
    .description("Configura el proveedor IA (API HTTP o Cursor CLI) para modo asistido")
    .option("--llm-provider <provider>", "Proveedor: http, openai, cursor-cli, etc.")
    .option("--llm-model <model>", "Modelo LLM a usar")
    .option("--llm-api-key <key>", "API key del proveedor LLM (solo HTTP)")
    .option("--llm-base-url <url>", "Base URL del proveedor LLM (solo HTTP)")
    .option("--clear", "Limpia la configuración IA guardada")
    .action(async (opts: ConfigOptions) => {
      const current = readAuth();
      if (!current) {
        p.log.error("No se encontró ~/.ghostly/auth.json. Ejecuta primero: ghostly install");
        process.exit(1);
      }

      if (opts.clear) {
        writeAuth({
          ...current,
          llm: undefined,
        });
        p.outro("Configuración IA eliminada de ~/.ghostly/auth.json");
        return;
      }

      const existingLlm = current.llm ?? {};
      const existingApiKey = existingLlm.apiKey ?? existingLlm.openaiApiKey ?? "";

      const providerChoice =
        opts.llmProvider ??
        (await p.select({
          message: "Proveedor IA para modo asistido",
          options: [
            {
              value: "cursor-cli",
              label: "Cursor Agent CLI",
              hint: "usa auth local (agent login)",
            },
            {
              value: "http",
              label: "API HTTP (OpenAI, Ollama, OpenRouter…)",
              hint: "requiere API key y URL",
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
          message: "Modelo",
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
            message: "API key del proveedor",
          }));
        if (p.isCancel(apiKey)) process.exit(0);

        const baseUrl =
          opts.llmBaseUrl ??
          (await p.text({
            message: "Base URL del chat completions",
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
          p.log.warn("Puedes continuar; el modo asistido fallará hasta que `agent login` funcione.");
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
          "Configuración IA guardada en ~/.ghostly/auth.json",
          `provider: ${nextProvider}`,
          `model: ${nextModel || "(vacío)"}`,
          useCli
            ? "auth: Cursor Agent CLI (sin API key en auth.json)"
            : `apiKey: ${nextApiKey ? "********" : "(vacía)"}`,
          useCli ? "" : `baseUrl: ${nextBaseUrl || "(vacía)"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
}
