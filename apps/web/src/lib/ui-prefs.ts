/**
 * Preferencias de UI locales (localStorage). Fuente única de la storage key
 * para que la escriba Configuración y la lea el modal de nueva ejecución sin
 * duplicar el nombre de la clave.
 */

const PREFS_STORAGE_KEY = "ghostly-ui-prefs";

export type UiPrefs = {
  /** Si false, las ejecuciones no graban video (recordVideoOnFailure). */
  video: boolean;
};

export const defaultUiPrefs: UiPrefs = {
  video: true,
};

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaultUiPrefs;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...defaultUiPrefs, ...parsed };
  } catch {
    return defaultUiPrefs;
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
