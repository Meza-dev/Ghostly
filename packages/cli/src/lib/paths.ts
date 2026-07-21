import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** ~/.ghostly/ */
export function getGhostDir(): string {
  const dir = resolve(homedir(), ".ghostly");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ~/.ghostly/auth.json */
export function getAuthFile(): string {
  return resolve(getGhostDir(), "auth.json");
}

/** ~/.ghostly/ghost.db */
export function getDbPath(): string {
  return resolve(getGhostDir(), "ghost.db");
}

/** Carpeta raíz del propio CLI instalado (junto a dist/) */
export function getCliRoot(): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  // En el build final, import.meta.url apunta a dist/index.js
  return resolve(distDir, "..");
}

/** Versión del CLI instalado (desde su package.json, junto a dist/). */
export function getCliVersion(): string {
  try {
    const raw = readFileSync(resolve(getCliRoot(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** <cliRoot>/dist/assets/api/dist  */
export function getApiDistDir(): string {
  return resolve(getCliRoot(), "dist", "assets", "api", "dist");
}

/** <cliRoot>/dist/assets/api/prisma */
export function getApiPrismaDir(): string {
  return resolve(getCliRoot(), "dist", "assets", "api", "prisma");
}

/** <cliRoot>/dist/assets/web */
export function getWebDistDir(): string {
  return resolve(getCliRoot(), "dist", "assets", "web");
}

/** <cliRoot>/dist/assets/mcp-server/index.js */
export function getMcpServerEntryPath(): string {
  return resolve(getCliRoot(), "dist", "assets", "mcp-server", "index.js");
}

/** Ruta al ~/.cursor/mcp.json (global de Cursor) */
export function getCursorMcpPath(): string {
  return resolve(homedir(), ".cursor", "mcp.json");
}

/**
 * Binario de Prisma CLI instalado junto con el CLI.
 * En Windows se usa el wrapper `.cmd`; en Unix el script sin extensión.
 */
export function getPrismaBin(): string {
  const ext = process.platform === "win32" ? ".cmd" : "";
  return resolve(getCliRoot(), "node_modules", ".bin", `prisma${ext}`);
}

/** Seed compilado que vive en el bundle de la API. */
export function getApiSeedPath(): string {
  return resolve(getApiDistDir(), "seed.js");
}

/** Directorio con binarios de Prisma engine. */
export function getPrismaEngineDir(): string {
  return resolve(getCliRoot(), "dist", "assets", "api", "prisma-engine");
}

/**
 * Ruta al archivo nativo del query engine que Prisma espera en PRISMA_QUERY_ENGINE_LIBRARY.
 * En Windows: *.dll.node, en Unix: *.so.node / *.dylib.node.
 */
export function getPrismaEngineLibraryPath(): string | null {
  const dir = getPrismaEngineDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const match = files.find((name) =>
    /^query_engine-.*\.(dll|so|dylib)\.node$/i.test(name),
  );
  return match ? resolve(dir, match) : null;
}
