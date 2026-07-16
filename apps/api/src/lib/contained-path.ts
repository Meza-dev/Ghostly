import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Resuelve `relative` contra `root` y devuelve la ruta real SOLO si queda
 * contenida dentro de `root` (C3). Cierra:
 *  - path traversal (`../`, backslash, rutas absolutas que ignoran la raíz):
 *    `resolve` compone la ruta y verificamos el prefijo con separador.
 *  - escape vía symlink (CWE-59): `realpathSync` canonicaliza ambos extremos
 *    antes de comparar.
 * Devuelve `null` si escapa, si no existe, o ante cualquier error de FS.
 */
export function containedPath(root: string, relative: string): string | null {
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(candidate);
    return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
  } catch {
    return null;
  }
}
