import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { generateApiKey, readAuth, writeAuth } from "../lib/auth.js";
import { buildMcpEntry } from "../lib/mcp-clients/entry.js";
import { cursorClient } from "../lib/mcp-clients/cursor.js";
import { getMcpServerEntryPath } from "../lib/paths.js";
import { isChromiumInstalled } from "../lib/playwright.js";

const DEFAULT_API_URL = "http://localhost:4000";

export function registerInstall(program: Command): void {
  program
    .command("install")
    .description("Set up Ghostly: API key, Cursor MCP, and browsers")
    .option("--api-url <url>", "Local backend URL", DEFAULT_API_URL)
    .action(async (opts: { apiUrl: string }) => {
      console.clear();
      p.intro("👻  Ghostly — Installation");

      const existingAuth = readAuth();
      let apiKey = existingAuth?.apiKey?.trim() ?? "";
      const hadExistingApiKey = apiKey.length > 0;
      if (!hadExistingApiKey) {
        apiKey = generateApiKey("uuid");
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
          p.log.info("No apiKey existed; one was generated automatically via ghostly keygen (uuid mode).");
        }
      } catch (err) {
        s1.stop("Failed to save credentials");
        p.log.error(String(err));
        process.exit(1);
      }

      // ── 3. Inyectar MCP en ~/.cursor/mcp.json ────────────────────────────
      const alreadyConfigured = cursorClient.isConfigured();
      let injectMcp = true;

      if (alreadyConfigured) {
        const overwrite = await p.confirm({
          message: "A Ghostly configuration already exists in ~/.cursor/mcp.json. Overwrite it?",
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          injectMcp = false;
          p.log.info("MCP configuration left unchanged.");
        }
      }

      if (injectMcp) {
        const s2 = p.spinner();
        s2.start("Injecting MCP server into ~/.cursor/mcp.json");
        try {
          const mcpEntryPath = getMcpServerEntryPath();
          if (!existsSync(mcpEntryPath)) {
            throw new Error(
              `${mcpEntryPath} not found. Reinstall or update @ghostly-io/cli to include the bundled MCP server.`,
            );
          }
          cursorClient.inject(buildMcpEntry(apiKey, opts.apiUrl));
          s2.stop("MCP server configured in Cursor ✓");
        } catch (err) {
          s2.stop("Failed to write mcp.json");
          p.log.error(String(err));
          p.log.warn("You can add it manually — see the documentation.");
        }
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

      // ── 5. Copiar reglas/skills de Cursor en ~/.cursor (global) ───────────
      cursorClient.installGuidance?.();

      // ── Resumen final ─────────────────────────────────────────────────────
      p.note(
        [
          "To enable AI-assisted mode, configure your provider credentials:",
          "",
          "  ghostly config",
          "",
          "You can also set ASSIST_LLM_API_KEY via an environment variable.",
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
