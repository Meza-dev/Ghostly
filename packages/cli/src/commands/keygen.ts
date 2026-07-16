import * as p from "@clack/prompts";
import type { Command } from "commander";
import { generateApiKey, readAuth, writeAuth } from "../lib/auth.js";

const DEFAULT_API_URL = "http://localhost:4000";

export function registerKeygen(program: Command): void {
  program
    .command("keygen")
    .description("Generate an API key and save it to ~/.ghostly/auth.json")
    .option("--token", "Generate a random hexadecimal token instead of a UUID", false)
    .option("--api-url <url>", "Local backend URL", DEFAULT_API_URL)
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
          "New API key generated and saved to ~/.ghostly/auth.json",
          `Format: ${mode}`,
          `apiKey: ${apiKey}`,
        ].join("\n"),
      );
    });
}
