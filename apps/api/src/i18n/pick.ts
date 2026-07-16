import { messages, type ApiMessageKey } from "./messages.js";

export type Lang = "en" | "es";

/** Elige idioma a partir del header Accept-Language. Default "en" (English-first). */
export function pickLang(acceptLanguage?: string): Lang {
  if (!acceptLanguage) return "en";
  return acceptLanguage.toLowerCase().includes("es") ? "es" : "en";
}

// Mismo motor de interpolación que apps/web/src/context/language-context.tsx
// (duplicado a propósito: cero deps cross-package).
function interpolate(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function msg(key: ApiMessageKey, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = messages[key];
  return interpolate(entry[lang], vars);
}
