import type { MessageKey } from "./en";

/** Diccionario ES — una key faltante acá es un error de compilación (Record completo). */
export const es: Record<MessageKey, string> = {
  "lang.toggle.toEs": "Cambiar a español",
  "lang.toggle.toEn": "Cambiar a inglés",
  "settings.language.title": "Idioma",
  "settings.language.desc": "Elige el idioma de la interfaz.",
  // T1 — verdict / statusBar
  "verdict.success.label": "Objetivo cumplido y verificado",
  "verdict.success.short": "Éxito",
  "verdict.failAppBug.label": "Ghostly encontró un problema en tu app",
  "verdict.failAppBug.short": "Bug encontrado",
  "verdict.failTestBroken.label": "El plan o la condición de victoria están mal definidos",
  "verdict.failTestBroken.short": "Test mal armado",
  "verdict.failAgentLost.label": "Ghostly no encontró el camino aunque existía",
  "verdict.failAgentLost.short": "Ghostly se perdió",
  "verdict.inconclusiveEnvironment.label": "El entorno falló (timeout, red, app caída)",
  "verdict.inconclusiveEnvironment.short": "Entorno inestable",
  "verdict.inconclusive.label": "La evidencia no alcanza para afirmar nada",
  "verdict.inconclusive.short": "Sin evidencia suficiente",
  "verdict.unclassified.label": "Sin clasificar (run anterior a v0.2)",
  "verdict.unclassified.short": "Sin clasificar",
  "verdict.why.title": "Por qué",
  "verdict.why.findingNote":
    "Este test hizo su trabajo: encontró un bug real en la aplicación. No es un error de Ghostly.",
  "verdict.why.judgeReasoning": "Razonamiento del juez",
  "verdict.why.confidence": "Confianza: {value}",
  "verdict.why.evidence": "Evidencia",
  "statusBar.runnerReady": "runner: listo",
  "statusBar.search": "Ctrl + Shift + K: buscar",
  "statusBar.newRun": "Ctrl + Shift + N: nueva ejecución",
};
