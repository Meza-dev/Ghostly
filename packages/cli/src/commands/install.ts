import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { generateApiKey, readAuth, writeAuth } from "../lib/auth.js";
import { configureClient } from "../lib/mcp-clients/configure.js";
import { buildMcpEntry } from "../lib/mcp-clients/entry.js";
import { detectClients } from "../lib/mcp-clients/registry.js";
import { resolveSelectedClients } from "../lib/mcp-clients/selection.js";
import type { McpClient } from "../lib/mcp-clients/types.js";
import { isChromiumInstalled } from "../lib/playwright.js";

const DEFAULT_API_URL = "http://localhost:4000";

/** Pregunta qué clientes MCP soportados configurar. Los detect-only se listan aparte (coming soon). */
async function selectClientsInteractively(
  detected: ReturnType<typeof detectClients>,
): Promise<McpClient[]> {
  const supportedDetected = detected.filter((d) => d.client.supported);
  const comingSoon = detected.filter((d) => !d.client.supported && d.installed);

  if (supportedDetected.length === 0) {
    p.log.warn("No supported MCP client detected. Skipping MCP setup — see the docs to configure manually.");
    return [];
  }

  // ponytail: @clack/prompts multiselect has no per-option "disabled" state, so detect-only
  // clients aren't rendered as options at all — they're surfaced via the info note below instead.
  // ponytail: nada pre-marcado — el usuario elige explícitamente qué configurar.
  // `required: true` evita el trap de Enter-sin-marcar (selección vacía silenciosa);
  // quien no quiera MCP cancela con Ctrl+C y el install sigue sin configurar nada.
  const answer = await p.multiselect({
    message: "Which MCP clients should Ghostly configure? (space to select, enter to confirm)",
    options: supportedDetected.map((d) => ({
      value: d.client.id,
      label: d.client.label,
      hint: d.installed ? "detected" : undefined,
    })),
    required: true,
  });

  if (comingSoon.length > 0) {
    p.log.info(`Also detected (coming soon): ${comingSoon.map((d) => d.client.label).join(", ")}`);
  }

  if (p.isCancel(answer)) {
    p.log.info("MCP setup skipped — run `ghostly mcp add <client>` anytime.");
    return [];
  }
  return resolveSelectedClients(detected, answer).selected;
}

export function registerInstall(program: Command): void {
  program
    .command("install")
    .description("Set up Ghostly: API key, MCP clients, and browsers")
    .option("--api-url <url>", "Local backend URL", DEFAULT_API_URL)
    .option(
      "--mcp-clients <ids>",
      "Comma-separated MCP client ids to configure non-interactively (e.g. cursor,claude-desktop)",
    )
    .action(async (opts: { apiUrl: string; mcpClients?: string }) => {
      console.clear();
      p.intro("Ghostly — Installation");

      const existingAuth = readAuth();
      let apiKey = existingAuth?.apiKey?.trim() ?? "";
      const hadExistingApiKey = apiKey.length > 0;
      if (!hadExistingApiKey) {
        apiKey = generateApiKey();
      }

      // ── 2. Guardar auth.json ──────────────────────────────────────────────
      const s1 = p.spinner();
      s1.start("Saving credentials to ~/.ghostly/auth.json");
      try {
        writeAuth({
          apiKey,
          apiUrl: opts.apiUrl,
          ...(existingAuth?.llm ? { llm: existingAuth.llm } : {}),
          ...(existingAuth?.extraEnv ? { extraEnv: existingAuth.extraEnv } : {}),
        });
        s1.stop("Credentials saved ✓");
        if (!hadExistingApiKey) {
          p.log.info("No apiKey existed; a secure one was generated automatically.");
        }
      } catch (err) {
        s1.stop("Failed to save credentials");
        p.log.error(String(err));
        process.exit(1);
      }

      // ── 3. Detectar clientes MCP y elegir cuáles configurar ────────────────
      const detected = detectClients();
      let selectedClients: McpClient[];
      if (opts.mcpClients) {
        const ids = opts.mcpClients.split(",").map((s) => s.trim()).filter(Boolean);
        const { selected, warnings } = resolveSelectedClients(detected, ids);
        selectedClients = selected;
        for (const warning of warnings) p.log.warn(warning);
      } else {
        selectedClients = await selectClientsInteractively(detected);
      }

      const entry = buildMcpEntry(apiKey, opts.apiUrl);
      for (const client of selectedClients) {
        await configureClient(client, entry);
      }

      // ── 4. Instalar Chromium (solo si no está instalado) ──────────────────
      if (isChromiumInstalled()) {
        p.log.info("Chromium is already installed ✓");
      } else {
        const installBrowsers = await p.confirm({
          message: "Chromium is not installed. Install it now? (required to run tests)",
          initialValue: true,
        });

        if (!p.isCancel(installBrowsers) && installBrowsers) {
          const s3 = p.spinner();
          s3.start("Installing Chromium (this may take a moment)");
          try {
            execSync("npx playwright install chromium", {
              stdio: "ignore",
              timeout: 300_000,
            });
            s3.stop("Chromium installed ✓");
          } catch {
            s3.stop("Could not install Chromium automatically");
            p.log.warn("Run manually: npx playwright install chromium");
          }
        }
      }

      // ── Resumen final ─────────────────────────────────────────────────────
      p.note(
        [
          "To enable AI-assisted mode, connect your AI provider (BYOK).",
          "Recommended: the dashboard — Settings → Assisted mode (after `ghostly up`).",
          "",
          "Prefer the terminal? Run: ghostly config",
        ].join("\n"),
        "AI configuration",
      );

      p.outro(`
✅  Installation completed successfully.

  Next steps:
  • Start local services:   ghostly up
  • Update the CLI:          ghostly update
  • Documentation:          https://ghostly.dev/docs
      `.trim());
    });
}
