/**
 * Auto-update: detección de versión nueva + reinicio orquestado por el CLI.
 *
 * La versión ACTUAL la inyecta `ghostly up` por env (`GHOST_APP_VERSION`, =
 * package.json del CLI). En dev (sin `up`) queda `null` y el dashboard no
 * ofrece update. La ÚLTIMA se consulta al registry público de npm. La
 * instalación NO corre en este proceso (lockea sus propios archivos en
 * Windows): el server sale con `UPDATE_EXIT_CODE` y `ghostly up` hace el
 * npm install + relanzamiento.
 */
const PACKAGE = "@ghostly-io/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;

/** Contrato con `ghostly up`: este exit code significa "instalá y relanzame". */
export const UPDATE_EXIT_CODE = 75;

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
