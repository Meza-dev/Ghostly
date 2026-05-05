import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import type { Command } from "commander";

export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description("Actualiza @ghostly-io/cli a la última versión")
    .action(() => {
      p.intro("👻  Ghostly — Actualizando CLI");

      const s = p.spinner();
      s.start("Instalando @ghostly-io/cli@latest");
      try {
        execSync("npm install -g @ghostly-io/cli@latest", {
          stdio: "inherit",
          timeout: 120_000,
        });
        s.stop("CLI actualizado ✓");
        p.outro("Reinicia tu terminal y ejecuta ghostly --version para confirmar.");
      } catch (err) {
        s.stop("Error durante la actualización");
        p.log.error(String(err));
        p.log.warn("Intenta manualmente: npm install -g @ghostly-io/cli@latest");
        process.exit(1);
      }
    });
}
