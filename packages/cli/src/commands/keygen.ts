import * as p from "@clack/prompts";
import type { Command } from "commander";
import { generateApiKey, readAuth, writeAuth } from "../lib/auth.js";

const DEFAULT_API_URL = "http://localhost:4000";

export function registerKeygen(program: Command): void {
  program
    .command("keygen")
    .description("Genera una API Key y la guarda en ~/.ghostly/auth.json")
    .option("--token", "Genera un token aleatorio hexadecimal en lugar de UUID", false)
    .option("--api-url <url>", "URL del backend local", DEFAULT_API_URL)
    .action((opts: { token?: boolean; apiUrl: string }) => {
      const mode = opts.token ? "token" : "uuid";
      const apiKey = generateApiKey(mode);
      const current = readAuth();
      const apiUrl = current?.apiUrl ?? opts.apiUrl;

      writeAuth({
        apiKey,
        apiUrl,
        ...(current?.llm ? { llm: current.llm } : {}),
        ...(current?.extraEnv ? { extraEnv: current.extraEnv } : {}),
      });

      p.outro(
        [
          "Nueva API Key generada y guardada en ~/.ghostly/auth.json",
          `Formato: ${mode}`,
          `apiKey: ${apiKey}`,
        ].join("\n"),
      );
    });
}
