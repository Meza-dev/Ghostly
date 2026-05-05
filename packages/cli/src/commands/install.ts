import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { generateApiKey, readAuth, writeAuth } from "../lib/auth.js";
import { isMcpAlreadyConfigured, injectGhostlyMcp } from "../lib/mcp.js";
import { getCursorRulesAssetsDir, getCursorSkillsAssetsDir, getMcpServerEntryPath } from "../lib/paths.js";
import { isChromiumInstalled } from "../lib/playwright.js";

const DEFAULT_API_URL = "http://localhost:4000";

function copyCursorAssetsGlobal(): { copied: number; skipped: boolean } {
  const rulesSrc = getCursorRulesAssetsDir();
  const skillsSrc = getCursorSkillsAssetsDir();
  if (!existsSync(rulesSrc) && !existsSync(skillsSrc)) {
    return { copied: 0, skipped: true };
  }

  const cursorDir = resolve(homedir(), ".cursor");
  const rulesDest = resolve(cursorDir, "rules");
  const skillsDest = resolve(cursorDir, "skills");
  mkdirSync(rulesDest, { recursive: true });
  mkdirSync(skillsDest, { recursive: true });

  let copied = 0;
  const ruleFile = resolve(rulesDest, "ghosttester-expert-architect.mdc");
  const skillDir = resolve(skillsDest, "ghosttester-expert-architect");

  if (existsSync(rulesSrc) && !existsSync(ruleFile)) {
    cpSync(rulesSrc, rulesDest, { recursive: true });
    copied += 1;
  }
  if (existsSync(skillsSrc) && !existsSync(skillDir)) {
    cpSync(skillsSrc, skillsDest, { recursive: true });
    copied += 1;
  }
  return { copied, skipped: false };
}

export function registerInstall(program: Command): void {
  program
    .command("install")
    .description("Configura Ghostly: API Key, MCP de Cursor y navegadores")
    .option("--api-url <url>", "URL del backend local", DEFAULT_API_URL)
    .action(async (opts: { apiUrl: string }) => {
      console.clear();
      p.intro("👻  Ghostly — Instalación");

      const existingAuth = readAuth();
      let apiKey = existingAuth?.apiKey?.trim() ?? "";
      const hadExistingApiKey = apiKey.length > 0;
      if (!hadExistingApiKey) {
        apiKey = generateApiKey("uuid");
      }

      // ── 2. Guardar auth.json ──────────────────────────────────────────────
      const s1 = p.spinner();
      s1.start("Guardando credenciales en ~/.ghostly/auth.json");
      try {
        writeAuth({
          apiKey,
          apiUrl: opts.apiUrl,
          ...(existingAuth?.llm ? { llm: existingAuth.llm } : {}),
          ...(existingAuth?.extraEnv ? { extraEnv: existingAuth.extraEnv } : {}),
        });
        s1.stop("Credenciales guardadas ✓");
        if (!hadExistingApiKey) {
          p.log.info("No existía apiKey, se generó automáticamente con ghostly keygen (modo uuid).");
        }
      } catch (err) {
        s1.stop("Error al guardar credenciales");
        p.log.error(String(err));
        process.exit(1);
      }

      // ── 3. Inyectar MCP en ~/.cursor/mcp.json ────────────────────────────
      const alreadyConfigured = isMcpAlreadyConfigured();
      let injectMcp = true;

      if (alreadyConfigured) {
        const overwrite = await p.confirm({
          message: "Ya existe una configuración de Ghostly en ~/.cursor/mcp.json. ¿Sobreescribir?",
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          injectMcp = false;
          p.log.info("Configuración MCP sin cambios.");
        }
      }

      if (injectMcp) {
        const s2 = p.spinner();
        s2.start("Inyectando servidor MCP en ~/.cursor/mcp.json");
        try {
          const mcpEntry = getMcpServerEntryPath();
          if (!existsSync(mcpEntry)) {
            throw new Error(
              `No se encontró ${mcpEntry}. Reinstala o actualiza @ghostly-io/cli para incluir el servidor MCP empaquetado.`,
            );
          }
          injectGhostlyMcp(apiKey, opts.apiUrl);
          s2.stop("Servidor MCP configurado en Cursor ✓");
        } catch (err) {
          s2.stop("Error al escribir mcp.json");
          p.log.error(String(err));
          p.log.warn("Puedes añadirlo manualmente — consulta la documentación.");
        }
      }

      // ── 4. Instalar Chromium (solo si no está instalado) ──────────────────
      if (isChromiumInstalled()) {
        p.log.info("Chromium ya está instalado ✓");
      } else {
        const installBrowsers = await p.confirm({
          message: "Chromium no está instalado. ¿Instalarlo ahora? (necesario para correr tests)",
          initialValue: true,
        });

        if (!p.isCancel(installBrowsers) && installBrowsers) {
          const s3 = p.spinner();
          s3.start("Instalando Chromium (puede tardar un momento)");
          try {
            execSync("npx playwright install chromium", {
              stdio: "ignore",
              timeout: 300_000,
            });
            s3.stop("Chromium instalado ✓");
          } catch {
            s3.stop("No se pudo instalar Chromium automáticamente");
            p.log.warn("Ejecuta manualmente: npx playwright install chromium");
          }
        }
      }

      // ── 5. Copiar reglas/skills de Cursor en ~/.cursor (global) ───────────
      const s4 = p.spinner();
      s4.start("Sincronizando reglas y skills en ~/.cursor/");
      try {
        const result = copyCursorAssetsGlobal();
        if (result.skipped) {
          s4.stop("No se encontraron assets de Cursor en este build");
          p.log.warn("Reinstala/actualiza el CLI para incluir reglas y skills empaquetadas.");
        } else if (result.copied === 0) {
          s4.stop("Reglas y skills globales ya estaban presentes ✓");
        } else {
          s4.stop(`Reglas y skills globales copiadas ✓ (${result.copied} bloques)`);
        }
      } catch (err) {
        s4.stop("No se pudieron importar reglas/skills");
        p.log.error(String(err));
      }

      // ── Resumen final ─────────────────────────────────────────────────────
      p.note(
        [
          "Para habilitar el modo asistido con IA, configura tus credenciales de proveedor:",
          "",
          "  ghostly config",
          "",
          "También puedes definir ASSIST_LLM_API_KEY por variable de entorno.",
        ].join("\n"),
        "Configuración de IA",
      );

      p.outro(`
✅  Instalación completada correctamente.

  Próximos pasos:
  • Iniciar servicios locales:   ghostly up
  • Actualizar el CLI:           ghostly update
  • Documentación:               https://ghostly.dev/docs
      `.trim());
    });
}
