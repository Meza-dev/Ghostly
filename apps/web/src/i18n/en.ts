/** Diccionario EN — fuente de verdad. Toda key nueva se agrega acá primero. */
export const en = {
  "lang.toggle.toEs": "Switch to Spanish",
  "lang.toggle.toEn": "Switch to English",
  "settings.language.title": "Language",
  "settings.language.desc": "Choose the interface language.",
} as const;

export type MessageKey = keyof typeof en;
