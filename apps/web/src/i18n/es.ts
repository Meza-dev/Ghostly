import type { MessageKey } from "./en";

/** Diccionario ES — una key faltante acá es un error de compilación (Record completo). */
export const es: Record<MessageKey, string> = {
  "lang.toggle.toEs": "Cambiar a español",
  "lang.toggle.toEn": "Cambiar a inglés",
  "settings.language.title": "Idioma",
  "settings.language.desc": "Elige el idioma de la interfaz.",
  // T7 — auth / app / common
  "common.loading": "Cargando…",
  "app.nav.flows": "Flujos & casos",
  "app.placeholder.comingSoon": "{title} — próximamente",
  "auth.login.error": "Error de login",
};
