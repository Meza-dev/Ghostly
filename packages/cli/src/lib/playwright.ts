import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Detecta si Playwright tiene Chromium instalado en el cache local.
 * Soporta las rutas estándar de Windows, Mac y Linux.
 */
export function isChromiumInstalled(): boolean {
  // La variable de entorno puede sobreescribir la ruta
  const customPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidates = customPath
    ? [customPath]
    : [
        // Windows
        join(process.env.LOCALAPPDATA ?? "", "ms-playwright"),
        // Mac
        join(homedir(), "Library", "Caches", "ms-playwright"),
        // Linux
        join(homedir(), ".cache", "ms-playwright"),
      ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      if (entries.some((e) => e.startsWith("chromium"))) return true;
    } catch {
      // no access — asumimos que no está
    }
  }
  return false;
}
