import * as p from "@clack/prompts";
import type { Command } from "commander";
import { readAuth } from "../lib/auth.js";
import { configureClient } from "../lib/mcp-clients/configure.js";
import { buildMcpEntry } from "../lib/mcp-clients/entry.js";
import { detectClients } from "../lib/mcp-clients/registry.js";

const DEFAULT_API_URL = "http://localhost:4000";

export function registerMcp(program: Command): void {
  const mcp = program.command("mcp").description("Inspect and configure Ghostly's MCP clients");

  mcp
    .command("list")
    .description("List detected MCP clients and their Ghostly configuration status")
    .action(() => {
      p.intro("👻  Ghostly — MCP clients");
      for (const { client, installed } of detectClients()) {
        const status = !client.supported
          ? "coming soon"
          : !installed
            ? "not detected"
            : client.isConfigured()
              ? "configured"
              : "not configured";
        p.log.info(`${client.label.padEnd(16)} installed: ${installed ? "yes" : "no"}  (${status})`);
      }
      p.outro("Run `ghostly mcp add <client>` to (re)configure a supported client.");
    });

  mcp
    .command("add <client>")
    .description("(Re)configure a single MCP client without a full reinstall, e.g. ghostly mcp add cursor")
    .option("--api-url <url>", "Local backend URL")
    .action(async (clientId: string, opts: { apiUrl?: string }) => {
      const id = clientId.trim().toLowerCase();
      const detected = detectClients();
      const match = detected.find((d) => d.client.id === id);

      if (!match) {
        p.log.error(`Unknown MCP client "${clientId}".`);
        p.log.info(`Known clients: ${detected.map((d) => d.client.id).join(", ")}`);
        process.exitCode = 1;
        return;
      }
      if (!match.client.supported) {
        p.log.error(`${match.client.label} is coming soon — not yet supported by ghostly mcp add.`);
        process.exitCode = 1;
        return;
      }

      const auth = readAuth();
      if (!auth?.apiKey) {
        p.log.error("No Ghostly credentials found. Run `ghostly install` first.");
        process.exitCode = 1;
        return;
      }

      p.intro(`👻  Ghostly — Configuring ${match.client.label}`);
      const entry = buildMcpEntry(auth.apiKey, opts.apiUrl ?? auth.apiUrl ?? DEFAULT_API_URL);
      await configureClient(match.client, entry);
      p.outro("Done.");
    });
}
