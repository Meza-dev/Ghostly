import type { MessageKey } from "./en";

/** Diccionario ES — una key faltante acá es un error de compilación (Record completo). */
export const es: Record<MessageKey, string> = {
  "lang.toggle.toEs": "Cambiar a español",
  "lang.toggle.toEn": "Cambiar a inglés",
  "settings.language.title": "Idioma",
  "settings.language.desc": "Elige el idioma de la interfaz.",
  // T2 — modals / rerun
  "modal.cancel": "Cancelar",
  "modal.newProject.title": "Nuevo proyecto",
  "modal.newProject.nameLabel": "Nombre del proyecto",
  "modal.newProject.namePlaceholder": "mi-proyecto-web",
  "modal.newProject.creating": "Creando…",
  "modal.newProject.create": "Crear",
  "rerun.rerunning": "Reejecutando…",
  "rerun.applyAndRerun": "Aplicar y reejecutar",
  "rerun.same": "Reejecutar igual",
  "rerun.button": "Reejecutar",
  "rerun.moreOptions": "Más opciones de reejecución",
  "rerun.menu.changeData": "Cambiar datos…",
  "rerun.menu.addInstructions": "Añadir instrucciones…",
  "rerun.changeData.title": "Cambiar datos",
  "rerun.changeData.noFields": "Este run no tiene campos de datos editables.",
  "rerun.changeData.sensitivePlaceholder": "•••• oculto — escribí un valor nuevo",
  "rerun.addInstructions.title": "Añadir instrucciones",
  "rerun.addInstructions.label": "Instrucción adicional",
  "rerun.addInstructions.placeholder": "Ejemplo: también validar el mensaje de bienvenida al finalizar.",
  "rerun.addInstructions.unavailable": "Este run no es asistido; no hay objetivo al que añadir instrucciones.",
};
