import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { killStrayGhostlyProcesses } from "../lib/processes.js";

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

      const s = p.spinner();
      s.start("Installing @ghostly-io/cli@latest");
      try {
        execSync("npm install -g @ghostly-io/cli@latest", {
          stdio: "inherit",
          timeout: 120_000,
        });
        s.stop("CLI updated ✓");
        p.outro("Restart your terminal and run ghostly --version to confirm.");
      } catch (err) {
        s.stop("Error during update");
        p.log.error(String(err));
        p.log.warn("Try manually: npm install -g @ghostly-io/cli@latest");
        process.exit(1);
      }
    });
}
