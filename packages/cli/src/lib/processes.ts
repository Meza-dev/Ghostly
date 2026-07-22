import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getCliRoot } from "./paths.js";

/**
 * Mata procesos node residuales que corren desde el paquete global @ghostly-io
 * (MCP servers de editores, servers viejos). En Windows esos procesos lockean
 * node_modules/@ghostly-io/cli y npm no puede renombrar el paquete al
 * actualizar (EBUSY). Best effort: los editores relanzan sus MCP servers solos.
 * Solo win32 — en unix el rename de npm no choca con archivos abiertos.
 */
/**
 * Borra los directorios de staging que npm deja al fallar un install
 * (node_modules/@ghostly-io/.cli-<random>). npm nunca los limpia y rompen
 * instalaciones futuras con ENOTEMPTY / EINVALIDPACKAGENAME. Best effort.
 * En el monorepo dirname(getCliRoot()) es packages/ — no hay matches, inocuo.
 */
export function cleanNpmStagingDirs(): void {
  const scopeDir = dirname(getCliRoot());
  if (!existsSync(scopeDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(scopeDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(".cli-")) continue;
    try {
      rmSync(resolve(scopeDir, entry), { recursive: true, force: true });
    } catch {
      // Best effort — un staging lockeado no debe frenar el update.
    }
  }
}

/** Espera síncrona sin bloquear con busy-loop (no hay sleep sync en Node). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const INSTALL_CMD = "npm install -g @ghostly-io/cli@latest";

/**
 * Instala la última versión del CLI con reintentos y backoff.
 * En Windows el AV/indexer retiene handles 1–2s después del taskkill, así que
 * un único npm install inmediato falla intermitentemente con EBUSY.
 * Último recurso: borrar el paquete instalado entero y reinstalar limpio
 * (los shims de npm en %APPDATA%\npm viven fuera del paquete, es seguro).
 */
export function installLatestWithRetry(log: (msg: string) => void): boolean {
  // Dar tiempo a que el SO libere los handles tras el taskkill.
  sleepSync(1500);

  const backoffs = [1_000, 2_000, 4_000];
  for (let attempt = 0; attempt < 4; attempt++) {
    cleanNpmStagingDirs();
    try {
      execSync(INSTALL_CMD, { stdio: "inherit", timeout: 300_000 });
      return true;
    } catch {
      const wait = backoffs[attempt];
      if (wait !== undefined) {
        log(`Install failed (files may still be locked) — retrying in ${wait / 1000}s…`);
        sleepSync(wait);
      }
    }
  }

  // Último recurso: instalación limpia desde cero.
  log("Retries exhausted — removing the installed package and reinstalling from scratch…");
  cleanNpmStagingDirs();
  const cliRoot = getCliRoot();
  // Guard: nunca borrar packages/cli en el monorepo durante desarrollo.
  if (cliRoot.includes("node_modules")) {
    try {
      rmSync(cliRoot, { recursive: true, force: true });
    } catch {
      // Si sigue lockeado, el install final igual puede funcionar.
    }
  }
  try {
    execSync(INSTALL_CMD, { stdio: "inherit", timeout: 300_000 });
    return true;
  } catch {
    return false;
  }
}

export function killStrayGhostlyProcesses(): void {
  if (process.platform !== "win32") return;
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*@ghostly-io*' } | " +
    "Select-Object -ExpandProperty ProcessId";
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0 || !result.stdout) return;
  for (const line of result.stdout.split(/\r?\n/)) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Ya muerto o sin permisos — seguimos.
    }
  }
}
