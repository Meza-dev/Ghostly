/**
 * Auto-update (MVP): detección de versión nueva + disparo del `npm install -g`.
 *
 * La versión ACTUAL la inyecta `ghostly up` por env (`GHOST_APP_VERSION`, =
 * package.json del CLI). En dev (sin `up`) queda `null` y el dashboard no
 * ofrece update. La ÚLTIMA se consulta al registry público de npm. El reinicio
 * con el código nuevo es manual (`ghostly up`) — el supervisor auto-restart
 * queda fuera del MVP.
 */
import { spawn } from "node:child_process";

const PACKAGE = "@ghostly-io/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;

/** Versión instalada, inyectada por `ghostly up`. `null` en dev. */
export function getCurrentVersion(): string | null {
  return process.env.GHOST_APP_VERSION ?? null;
}

/** [major, minor, patch] o null si el string no parsea. Ignora prerelease/build. */
function parseVersion(v: string): [number, number, number] | null {
  const parts = v.trim().replace(/^v/, "").split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number.parseInt(parts[2] ?? "0", 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return [major, minor, Number.isFinite(patch) ? patch : 0];
}

/** true si `latest` es estrictamente mayor que `current` (semver básico x.y.z). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/** Última versión publicada en npm, o null si el registry falla/timeout. */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Corre `npm install -g @ghostly-io/cli@latest`. Puede fallar por permisos
 * (EACCES en instalaciones globales sin sudo) — se devuelve el error para que
 * la UI sugiera correr `ghostly update` a mano. shell:true en Windows para
 * resolver `npm` → `npm.cmd`.
 */
export function runUpdate(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["install", "-g", `${PACKAGE}@latest`], {
      shell: process.platform === "win32",
      timeout: 180_000,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => resolvePromise({ ok: false, error: err.message }));
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ ok: true });
      else resolvePromise({ ok: false, error: stderr.trim() || `npm salió con código ${code}` });
    });
  });
}
