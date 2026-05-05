import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { authToEnv, readAuth } from "../lib/auth.js";
import {
  getApiDistDir,
  getApiPrismaDir,
  getApiSeedPath,
  getDbPath,
  getPrismaEngineLibraryPath,
  getPrismaBin,
  getWebDistDir,
} from "../lib/paths.js";

const DEFAULT_PORT = 4000;
const DEFAULT_ADMIN_EMAIL = "admin@ghostly.local";
const DEFAULT_ADMIN_PASSWORD = "admin123";

function runPrisma(args: string, prismaDir: string, databaseUrl: string): void {
  const bin = getPrismaBin();
  const bin_exists = existsSync(bin);
  const cmd = bin_exists ? `"${bin}" ${args}` : `npx prisma ${args}`;

  execSync(cmd, {
    stdio: "ignore",
    cwd: prismaDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
    timeout: 90_000,
  });
}

export function registerUp(program: Command): void {
  program
    .command("up")
    .description("Levanta el backend y frontend de Ghostly localmente")
    .option("-p, --port <number>", "Puerto del backend", String(DEFAULT_PORT))
    .action(async (opts: { port: string }) => {
      const port = Number.parseInt(opts.port, 10) || DEFAULT_PORT;

      console.clear();
      p.intro("👻  Ghostly — Iniciando servicios");

      // ── 1. Verificar auth ─────────────────────────────────────────────────
      const auth = readAuth();
      if (!auth) {
        p.log.error("No se encontraron credenciales. Ejecuta primero: ghostly install");
        process.exit(1);
      }

      // ── 2. Verificar assets del CLI ───────────────────────────────────────
      const apiDist = getApiDistDir();
      const apiPrisma = getApiPrismaDir();
      const webDist = getWebDistDir();
      const seedPath = getApiSeedPath();

      if (!existsSync(apiDist)) {
        p.log.error(`No se encontró el bundle de la API en: ${apiDist}`);
        p.log.warn("Asegúrate de haber instalado el CLI desde un build completo.");
        process.exit(1);
      }

      // ── 3. Detectar si la base de datos es nueva ──────────────────────────
      const dbPath = getDbPath();
      const isNewDb = !existsSync(dbPath);
      const databaseUrl = `file:${dbPath}`;

      // ── 4. Preparar base de datos (db push) ───────────────────────────────
      const s1 = p.spinner();
      s1.start(isNewDb ? `Creando base de datos en ${dbPath}` : `Actualizando esquema de base de datos`);
      try {
        runPrisma("db push --skip-generate --accept-data-loss", apiPrisma, databaseUrl);
        s1.stop(isNewDb ? "Base de datos creada ✓" : "Esquema actualizado ✓");
      } catch (err) {
        s1.stop("Advertencia: no se pudo ejecutar la migración automática");
        p.log.warn(String(err));
        p.log.warn("El servidor intentará conectarse a la DB de todas formas.");
      }

      // ── 4.5 Generar cliente Prisma para esta instalación global ───────────
      const s15 = p.spinner();
      s15.start("Generando cliente Prisma local");
      try {
        runPrisma("generate --schema schema.prisma", apiPrisma, databaseUrl);
        s15.stop("Cliente Prisma generado ✓");
      } catch (err) {
        s15.stop("Error al generar cliente Prisma");
        p.log.error(String(err));
        p.log.warn("Reinstala el CLI y vuelve a intentar.");
        process.exit(1);
      }

      // ── 5. Seed automático en base de datos nueva ─────────────────────────
      if (isNewDb && existsSync(seedPath)) {
        const s2 = p.spinner();
        s2.start("Ejecutando seed inicial (usuario admin)");
        try {
          const enginePath = getPrismaEngineLibraryPath();
          const seedEnv: NodeJS.ProcessEnv = {
            ...process.env,
            DATABASE_URL: databaseUrl,
            ...(enginePath ? { PRISMA_QUERY_ENGINE_LIBRARY: enginePath } : {}),
          };
          execSync(`"${process.execPath}" "${seedPath}"`, {
            stdio: "ignore",
            cwd: apiDist,
            env: seedEnv,
            timeout: 30_000,
            shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
          });
          s2.stop("Seed ejecutado ✓");
        } catch (err) {
          s2.stop("Advertencia: no se pudo ejecutar el seed inicial");
          p.log.warn(String(err));
          p.log.warn("Puedes crear el usuario admin manualmente desde la UI.");
        }
      }

      // ── 6. Construir env vars del proceso hijo ────────────────────────────
      const enginePath = getPrismaEngineLibraryPath();
      const authEnv = authToEnv(auth);

      const serverEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...authEnv,
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        GHOST_WEB_DIR: webDist,
        API_PORT: String(port),
        HOST: "127.0.0.1",
        ...(enginePath ? { PRISMA_QUERY_ENGINE_LIBRARY: enginePath } : {}),
      };

      // ── 7. Advertir si falta config del LLM ──────────────────────────────
      const hasConfiguredLlmKey = Boolean(auth.llm?.apiKey || auth.llm?.openaiApiKey);
      if (!hasConfiguredLlmKey && !serverEnv["ASSIST_LLM_API_KEY"] && !serverEnv["OPENAI_API_KEY"]) {
        p.log.warn(
          "El modo asistido con IA no está configurado. Para habilitarlo ejecuta:\n" +
          "  ghostly config",
        );
      }

      // ── 8. Lanzar servidor (API + Frontend estático) ──────────────────────
      const apiEntry = `${apiDist}/index.js`;
      p.log.info(`Iniciando servidor en http://localhost:${port}`);

      const server = spawn(process.execPath, [apiEntry], {
        env: serverEnv,
        stdio: "inherit",
        cwd: apiDist,
      });

      server.on("error", (err) => {
        p.log.error(`Error al iniciar el servidor: ${err.message}`);
        process.exit(1);
      });

      server.on("close", (code) => {
        if (code !== 0 && code !== null) {
          p.log.error(`El servidor finalizó con código: ${code}`);
        }
        process.exit(code ?? 0);
      });

      // Propagar señales para un shutdown limpio
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, () => {
          // En Windows, SIGINT no siempre termina al hijo; forzamos fallback.
          server.kill(sig);
          setTimeout(() => {
            if (!server.killed) {
              server.kill("SIGKILL");
            }
            process.exit(0);
          }, 1500);
        });
      }

      p.outro(`
✅  Ghostly en ejecución

  Servicios:
  • Dashboard + API:   http://localhost:${port}
  • Healthcheck:       http://localhost:${port}/health

  Acceso inicial (seed):
  • Email:             ${DEFAULT_ADMIN_EMAIL}
  • Password:          ${DEFAULT_ADMIN_PASSWORD}

  Presiona Ctrl+C para detener.
      `.trim());
    });
}
