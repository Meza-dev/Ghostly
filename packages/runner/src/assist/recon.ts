import { chromium } from "playwright";
import { captureObserverSnapshot } from "./observer.js";
import type { ObserverSnapshot } from "./types.js";

export type ReconOptions = {
  headless?: boolean;
  timeoutMs?: number;
  observerMaxNodes?: number;
};

/** Lanza Chromium, navega a baseUrl, captura observer snapshot y cierra. */
export async function captureRecon(
  baseUrl: string,
  options: ReconOptions = {},
): Promise<ObserverSnapshot> {
  const headless = options.headless ?? true;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const observerMaxNodes = options.observerMaxNodes ?? 300;
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // El Observer internamente espera networkidle + reintenta si el mapa es pobre,
    // así cubrimos SPAs que muestran loader antes de montar el formulario.
    const snapshot = await captureObserverSnapshot(page, observerMaxNodes);
    await context.close();
    return snapshot;
  } finally {
    await browser.close();
  }
}
