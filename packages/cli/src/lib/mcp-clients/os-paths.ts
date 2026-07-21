import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** ~/.config — usado por Linux/XDG y como fallback genérico. */
export function homeConfigDir(): string {
  return resolve(homedir(), ".config");
}

/** Windows %APPDATA% (fallback si la env var no está seteada). */
export function appDataDir(): string {
  return process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming");
}

/** Windows %LOCALAPPDATA% — ahí viven los paquetes MSIX. */
export function localAppDataDir(): string {
  return process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local");
}

/** macOS ~/Library/Application Support */
export function macAppSupportDir(): string {
  return resolve(homedir(), "Library", "Application Support");
}

/** True si `name` resuelve en el PATH (Windows `where`, Unix `which`). Nunca tira. */
export function isBinaryOnPath(name: string): boolean {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    execSync(`${finder} ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
