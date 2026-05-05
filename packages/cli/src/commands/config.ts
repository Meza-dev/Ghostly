import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readAuth, writeAuth } from "../lib/auth.js";

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
    .description("Configura el proveedor IA (modelo, api key y base URL) para modo asistido")
    .option("--llm-provider <provider>", "Proveedor LLM (openai, anthropic, ollama, openrouter, azure, etc.)")
    .option("--llm-model <model>", "Modelo LLM a usar")
    .option("--llm-api-key <key>", "API key del proveedor LLM")
    .option("--llm-base-url <url>", "Base URL del proveedor LLM")
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

      const provider =
        opts.llmProvider ??
        (await p.text({
          message: "Proveedor LLM",
          placeholder: existingLlm.provider ?? "openai / anthropic / ollama / openrouter / azure",
          initialValue: existingLlm.provider ?? "",
        }));
      if (p.isCancel(provider)) process.exit(0);

      const model =
        opts.llmModel ??
        (await p.text({
          message: "Modelo",
          placeholder: existingLlm.model ?? "gpt-4o-mini, claude-3-5-sonnet, llama3, etc.",
          initialValue: existingLlm.model ?? "",
        }));
      if (p.isCancel(model)) process.exit(0);

      const apiKey =
        opts.llmApiKey ??
        (await p.password({
          message: "API key del proveedor",
        }));
      if (p.isCancel(apiKey)) process.exit(0);

      const baseUrl =
        opts.llmBaseUrl ??
        (await p.text({
          message: "Base URL (opcional)",
          placeholder: existingLlm.baseUrl ?? "https://api.openai.com/v1",
          initialValue: existingLlm.baseUrl ?? "",
        }));
      if (p.isCancel(baseUrl)) process.exit(0);

      const nextApiKey = (opts.llmApiKey ?? apiKey).trim() || existingApiKey;
      const nextProvider = String(provider).trim();
      const nextModel = String(model).trim();
      const nextBaseUrl = String(baseUrl).trim();

      writeAuth({
        ...current,
        llm: {
          ...(nextProvider ? { provider: nextProvider } : {}),
          ...(nextModel ? { model: nextModel } : {}),
          ...(nextApiKey ? { apiKey: nextApiKey } : {}),
          ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
        },
      });

      p.outro(
        [
          "Configuración IA guardada en ~/.ghostly/auth.json",
          `provider: ${nextProvider || "(vacío)"}`,
          `model: ${nextModel || "(vacío)"}`,
          `apiKey: ${nextApiKey ? "********" : "(vacía)"}`,
          `baseUrl: ${nextBaseUrl || "(vacía)"}`,
        ].join("\n"),
      );
    });
}
