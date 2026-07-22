import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { authToEnv, ensureJwtSecret, readAuth } from "../lib/auth.js";
import { killStrayGhostlyProcesses } from "../lib/processes.js";
import { isAssistLlmConfigured } from "../lib/llm-check.js";
import { isCliLlmProvider } from "../lib/llm-providers.js";
import {
  getApiDistDir,
  getApiPrismaDir,
  getApiSeedPath,
  getCliVersion,
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
    .description("Start the Ghostly backend and frontend locally")
    .option("-p, --port <number>", "Backend port", String(DEFAULT_PORT))
    .action(async (opts: { port: string }) => {
      const port = Number.parseInt(opts.port, 10) || DEFAULT_PORT;

      console.clear();
      p.intro("Ghostly — Starting services");

      // ── 1. Verificar auth ─────────────────────────────────────────────────
      const auth = readAuth();
      if (!auth) {
        p.log.error("No credentials found. Run this first: ghostly install");
        process.exit(1);
      }

      // ── 2. Verificar assets del CLI ───────────────────────────────────────
      const apiDist = getApiDistDir();
      const apiPrisma = getApiPrismaDir();
      const webDist = getWebDistDir();
      const seedPath = getApiSeedPath();

      if (!existsSync(apiDist)) {
        p.log.error(`API bundle not found at: ${apiDist}`);
        p.log.warn("Make sure you installed the CLI from a complete build.");
        process.exit(1);
      }

      // ── 3. Detectar si la base de datos es nueva ──────────────────────────
      const dbPath = getDbPath();
      const isNewDb = !existsSync(dbPath);
      const databaseUrl = `file:${dbPath}`;

      // ── 4. Preparar base de datos (db push) ───────────────────────────────
      const s1 = p.spinner();
      s1.start(isNewDb ? `Creating database at ${dbPath}` : `Updating database schema`);
      try {
        runPrisma("db push --skip-generate --accept-data-loss", apiPrisma, databaseUrl);
        s1.stop(isNewDb ? "Database created ✓" : "Schema updated ✓");
      } catch (err) {
        s1.stop("Warning: could not run the automatic migration");
        p.log.warn(String(err));
        p.log.warn("The server will try to connect to the DB anyway.");
      }

      // ── 4.5 Generar cliente Prisma para esta instalación global ───────────
      const s15 = p.spinner();
      s15.start("Generating local Prisma client");
      try {
        runPrisma("generate --schema schema.prisma", apiPrisma, databaseUrl);
        s15.stop("Prisma client generated ✓");
      } catch (err) {
        s15.stop("Failed to generate Prisma client");
        p.log.error(String(err));
        p.log.warn("Reinstall the CLI and try again.");
        process.exit(1);
      }

      // ── 5. Seed automático en base de datos nueva ─────────────────────────
      if (isNewDb && existsSync(seedPath)) {
        const s2 = p.spinner();
        s2.start("Running initial seed (admin user)");
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
          s2.stop("Seed completed ✓");
        } catch (err) {
          s2.stop("Warning: could not run the initial seed");
          p.log.warn(String(err));
          p.log.warn("You can create the admin user manually from the UI.");
        }
      }

      // ── 6. Construir env vars del proceso hijo ────────────────────────────
      const enginePath = getPrismaEngineLibraryPath();
      // C2: genera/persiste un JWT_SECRET fuerte si falta, para que `up` arranque
      // sin configuración manual. Se inyecta al API vía extraEnv en authToEnv().
      ensureJwtSecret(auth);
      const authEnv = authToEnv(auth);

      const serverEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...authEnv,
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        GHOST_WEB_DIR: webDist,
        GHOST_APP_VERSION: getCliVersion(),
        API_PORT: String(port),
        HOST: "127.0.0.1",
        // Watchdog: el server se auto-apaga si el CLI padre desaparece (ver api/index.ts).
        GHOST_PARENT_PID: String(process.pid),
        ...(enginePath ? { PRISMA_QUERY_ENGINE_LIBRARY: enginePath } : {}),
      };

      // ── 7. Advertir si falta config del LLM ──────────────────────────────
      const assistConfigured = isAssistLlmConfigured(auth);
      if (!assistConfigured && !serverEnv["ASSIST_LLM_API_KEY"] && !serverEnv["OPENAI_API_KEY"]) {
        p.log.warn(
          "AI-assisted mode is not configured yet. Enable it from the dashboard\n" +
            "(Settings → Assisted mode) once it's running — or run: ghostly config",
        );
      } else if (isCliLlmProvider(auth.llm?.provider)) {
        p.log.info("Assisted mode: Cursor Agent CLI (local auth)");
      }

      // ── 8. Lanzar servidor (API + Frontend estático) ──────────────────────
      const apiEntry = `${apiDist}/index.js`;
      p.log.info(`Starting server at http://localhost:${port}`);

      // Bug de @clack en Windows: el spinner activa raw mode en stdin y nunca lo
      // restaura (solo lo hace en unix). Sin ENABLE_PROCESSED_INPUT la consola no
      // genera el evento Ctrl+C y el server queda imposible de cortar. Restaurar.
      if (process.stdin.isTTY) process.stdin.setRawMode(false);

      // Contrato con POST /v1/update del API: este exit code significa
      // "instalá la versión nueva y relanzame" (ver apps/api services/updater.ts).
      const UPDATE_EXIT_CODE = 75;

      const startServer = (): ReturnType<typeof spawn> => {
        const child = spawn(process.execPath, [apiEntry], {
          env: serverEnv,
          stdio: "inherit",
          cwd: apiDist,
        });
        child.on("error", (err) => {
          p.log.error(`Failed to start the server: ${err.message}`);
          process.exit(1);
        });
        child.on("close", (code) => {
          if (code === UPDATE_EXIT_CODE) {
            runSelfUpdate();
            return;
          }
          if (code !== 0 && code !== null) {
            p.log.error(`The server exited with code: ${code}`);
          }
          process.exit(code ?? 0);
        });
        return child;
      };

      const runSelfUpdate = (): void => {
        p.log.info("Update requested from the dashboard.");
        // Los MCP servers de los editores corren desde el mismo paquete global
        // y lockean archivos en Windows — matarlos antes del npm install
        // (los editores los relanzan solos).
        killStrayGhostlyProcesses();
        p.log.info("Installing @ghostly-io/cli@latest…");
        try {
          execSync("npm install -g @ghostly-io/cli@latest", {
            stdio: "inherit",
            timeout: 300_000,
          });
        } catch (err) {
          p.log.error(String(err));
          p.log.warn("Automatic update failed. Run manually: ghostly update");
          process.exit(1);
        }
        p.log.info("CLI updated — restarting the server…");
        server = startServer();
      };

      let server = startServer();

      // Shutdown: en Windows, `server.kill()` no alcanza a los nietos (Prisma, etc.)
      // y el server queda huérfano al cerrar la terminal. `taskkill /T /F` mata el
      // árbol completo, de forma síncrona (usable también en el handler de "exit").
      let stopped = false;
      const stopServer = (): void => {
        if (stopped || server.exitCode !== null) return;
        stopped = true;
        if (process.platform === "win32" && server.pid) {
          try {
            execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
          } catch {
            // El proceso ya no existe — nada que hacer.
          }
        } else {
          server.kill("SIGTERM");
          setTimeout(() => {
            if (!server.killed) server.kill("SIGKILL");
          }, 1500).unref();
        }
      };

      // SIGHUP cubre el cierre de la ventana de terminal; "exit" es el último recurso.
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.on(sig, () => {
          stopServer();
          process.exit(0);
        });
      }
      process.on("exit", stopServer);

      p.outro(`
✅  Ghostly is running

  Services:
  • Dashboard + API:   http://localhost:${port}
  • Healthcheck:       http://localhost:${port}/health

  Initial login (seed):
  • Email:             ${DEFAULT_ADMIN_EMAIL}
  • Password:          ${DEFAULT_ADMIN_PASSWORD}

  Press Ctrl+C to stop.
      `.trim());
    });
}
