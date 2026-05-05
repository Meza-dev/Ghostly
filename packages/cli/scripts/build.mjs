/**
 * Build script for @ghostly-io/cli
 *
 * Orden de operaciones:
 *   1. Build de apps/api  (tsup → apps/api/dist)
 *   2. Build de apps/web  (vite → apps/web/dist)
 *   3. Build de packages/mcp-server (tsup → packages/mcp-server/dist)
 *   4. Prisma generate (desde apps/api)
 *   5. tsup del propio código del CLI
 *   6. Copy apps/api/dist  → packages/cli/dist/assets/api/dist
 *      Copy apps/api/prisma → packages/cli/dist/assets/api/prisma
 *      Copy apps/web/dist  → packages/cli/dist/assets/web
 *      Copy packages/mcp-server/dist → packages/cli/dist/assets/mcp-server
 *      Copy prisma engine  → packages/cli/dist/assets/api/prisma-engine
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const cliDir = resolve(__dirname, "..");
const cliDist = resolve(cliDir, "dist");
const assetsDir = resolve(cliDist, "assets");

function run(cmd, cwd = root) {
  console.log(`\n▶  ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function copy(src, dest) {
  console.log(`📦  ${src} → ${dest}`);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function copyFile(src, destFile) {
  console.log(`📦  ${src} → ${destFile}`);
  mkdirSync(dirname(destFile), { recursive: true });
  cpSync(src, destFile);
}

function safeRemove(target) {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (err) {
    console.warn(`⚠️  No se pudo limpiar ${target} (se continuará): ${String(err)}`);
  }
}

function removeTempAndDevDb(baseDir) {
  if (!existsSync(baseDir)) return;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (lower.includes(".tmp") || lower === "dev.db") {
        safeRemove(full);
      }
    }
  };
  walk(baseDir);
}

/** Elimina todos los `.map` bajo un directorio (red de seguridad para el tarball npm). */
function removeSourceMaps(baseDir) {
  if (!existsSync(baseDir)) return;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith(".map")) {
        safeRemove(full);
      }
    }
  };
  walk(baseDir);
}

/**
 * Busca el directorio .prisma/client en node_modules.
 * Soporta tanto npm clásico como pnpm (que los aloja en .pnpm/<hash>/node_modules/.prisma/client).
 */
function findPrismaEngineDir(startDirs) {
  for (const base of startDirs) {
    // Ruta clásica de npm
    const classic = join(base, ".prisma", "client");
    if (existsSync(classic)) return classic;

    // Ruta de pnpm: node_modules/.pnpm/@prisma+client@X.Y.Z/node_modules/.prisma/client
    const pnpmDir = join(base, ".pnpm");
    if (!existsSync(pnpmDir)) continue;

    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith("@prisma+client")) continue;
      const candidate = join(pnpmDir, entry, "node_modules", ".prisma", "client");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// ─── 1. Build apps/api ────────────────────────────────────────────────────────
console.log("\n═══ [1/5] Building apps/api ═══");
const apiDir = resolve(root, "apps/api");
run("pnpm --filter @ghostly-io/api build");

// ─── 2. Build apps/web ────────────────────────────────────────────────────────
console.log("\n═══ [2/5] Building apps/web ═══");
run("pnpm --filter @ghostly-io/web build");

// ─── 3. Build packages/mcp-server ─────────────────────────────────────────────
console.log("\n═══ [3/6] Building packages/mcp-server ═══");
run("pnpm --filter @ghostly-io/mcp-server build");

// ─── 4. Prisma generate ───────────────────────────────────────────────────────
console.log("\n═══ [4/6] Prisma generate ═══");
try {
  run("pnpm exec prisma generate --schema prisma/schema.prisma", apiDir);
} catch (err) {
  console.warn("⚠️  Prisma generate falló; se continuará con los artefactos existentes.");
  console.warn(`   Detalle: ${String(err)}`);
}

// ─── 5. Compilar el CLI con tsup ─────────────────────────────────────────────
console.log("\n═══ [5/6] Building CLI (tsup) ═══");
run("pnpm exec tsup", cliDir);

// ─── 6. Copiar artefactos al CLI ──────────────────────────────────────────────
console.log("\n═══ [6/6] Copying assets to packages/cli/dist/assets ═══");

const apiAssets = resolve(assetsDir, "api");
const webAssets = resolve(assetsDir, "web");
const mcpAssets = resolve(assetsDir, "mcp-server");
const cursorRulesAssets = resolve(assetsDir, "cursor", "rules");
const cursorSkillsAssets = resolve(assetsDir, "cursor", "skills");
safeRemove(apiAssets);
safeRemove(webAssets);
safeRemove(mcpAssets);
safeRemove(resolve(assetsDir, "cursor"));

// API: dist compilado (index.js + seed.js)
copy(resolve(apiDir, "dist"), resolve(apiAssets, "dist"));
// API: schema de Prisma (para prisma db push en runtime)
copy(resolve(apiDir, "prisma"), resolve(apiAssets, "prisma"));
// Web: build estático de Vite
copy(resolve(root, "apps/web/dist"), webAssets);
// MCP server: runtime local para integración con Cursor
copy(resolve(root, "packages/mcp-server/dist"), mcpAssets);
// Reglas y skills de Cursor para onboarding del proyecto.
copyFile(
  resolve(root, ".cursor/rules/ghosttester-expert-architect.mdc"),
  resolve(cursorRulesAssets, "ghosttester-expert-architect.mdc"),
);
copy(
  resolve(root, ".cursor/skills/ghosttester-expert-architect"),
  resolve(cursorSkillsAssets, "ghosttester-expert-architect"),
);

// Engine de Prisma: buscar en npm y en pnpm store
const engineSrc = findPrismaEngineDir([
  resolve(apiDir, "node_modules"),
  resolve(root, "node_modules"),
]);

if (engineSrc) {
  try {
    copy(engineSrc, resolve(apiAssets, "prisma-engine"));
  } catch (err) {
    console.warn("⚠️  No se pudo copiar prisma-engine (archivo bloqueado).");
    console.warn(`   Se reutilizará el engine existente si está presente. Detalle: ${String(err)}`);
  }
} else {
  console.warn("⚠️  No se encontraron binarios del engine de Prisma.");
  console.warn("   Ejecuta manualmente: pnpm exec prisma generate --schema apps/api/prisma/schema.prisma");
}

// Limpieza final de artefactos no publicables en npm.
removeTempAndDevDb(apiAssets);
removeSourceMaps(cliDist);

console.log("\n✅  @ghostly-io/cli build complete");
console.log(`   dist → ${cliDist}`);
