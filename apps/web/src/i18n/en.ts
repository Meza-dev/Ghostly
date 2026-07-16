/** Diccionario EN — fuente de verdad. Toda key nueva se agrega acá primero. */
export const en = {
  "lang.toggle.toEs": "Switch to Spanish",
  "lang.toggle.toEn": "Switch to English",
  "settings.language.title": "Language",
  "settings.language.desc": "Choose the interface language.",
  // T2 — modals / rerun
  "modal.cancel": "Cancel",
  "modal.newProject.title": "New project",
  "modal.newProject.nameLabel": "Project name",
  "modal.newProject.namePlaceholder": "my-web-project",
  "modal.newProject.creating": "Creating…",
  "modal.newProject.create": "Create",
  "rerun.rerunning": "Rerunning…",
  "rerun.applyAndRerun": "Apply and rerun",
  "rerun.same": "Rerun same",
  "rerun.button": "Rerun",
  "rerun.moreOptions": "More rerun options",
  "rerun.menu.changeData": "Change data…",
  "rerun.menu.addInstructions": "Add instructions…",
  "rerun.changeData.title": "Change data",
  "rerun.changeData.noFields": "This run has no editable data fields.",
  "rerun.changeData.sensitivePlaceholder": "•••• hidden — type a new value",
  "rerun.addInstructions.title": "Add instructions",
  "rerun.addInstructions.label": "Additional instruction",
  "rerun.addInstructions.placeholder": "Example: also validate the welcome message at the end.",
  "rerun.addInstructions.unavailable": "This run is not assisted; there is no goal to add instructions to.",
} as const;

export type MessageKey = keyof typeof en;
