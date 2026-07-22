import * as p from "@clack/prompts";
import type { Command } from "commander";
import { installLatestWithRetry, killStrayGhostlyProcesses } from "../lib/processes.js";

export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description("Update @ghostly-io/cli to the latest version")
    .action(() => {
      p.intro("Ghostly — Updating CLI");

      // Procesos corriendo desde el paquete global (server viejo, MCP servers
      // de editores) lockean archivos en Windows y npm falla con EBUSY.
      p.log.info("Stopping running Ghostly processes…");
      killStrayGhostlyProcesses();

      // Sin spinner: el install usa stdio inherit y los reintentos loguean.
      p.log.info("Installing @ghostly-io/cli@latest…");
      const ok = installLatestWithRetry((m) => p.log.info(m));
      if (!ok) {
        p.log.error("All install attempts failed.");
        p.log.warn("Try manually: npm uninstall -g @ghostly-io/cli ; npm install -g @ghostly-io/cli@latest");
        process.exit(1);
      }
      p.outro("CLI updated ✓ — restart your terminal and run ghostly --version to confirm.");
    });
}
