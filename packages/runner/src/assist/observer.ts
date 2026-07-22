/// <reference lib="dom" />
import type { Page } from "playwright";
import type { ObserverSnapshot, PageError, PageErrorSeverity, VisibleDialogInfo } from "./types.js";

const INTERACTIVE_REGEX = /^\s*-\s+(button|link|textbox|combobox|checkbox|radio|menuitem|searchbox|spinbutton|switch|tab|option|slider|listbox)\b/i;

function countLines(markdown: string, max: number): { text: string; nodeCount: number } {
  const lines = markdown.split("\n");
  let nodeCount = 0;
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (trimmed.startsWith("- ")) nodeCount += 1;
    out.push(line);
    if (out.length >= max) break;
  }
  return { text: out.join("\n"), nodeCount };
}

function countInteractive(markdown: string): number {
  return markdown.split("\n").reduce((acc, line) => (INTERACTIVE_REGEX.test(line) ? acc + 1 : acc), 0);
}

async function ariaSnapshotSafe(page: Page): Promise<string> {
  try {
    return await page.locator("body").ariaSnapshot({ mode: "ai", timeout: 10_000 });
  } catch {
    return "";
  }
}

/** Quita `[ref=eNN]` del snapshot: son efímeros del motor a11y, no selectores CSS válidos. */
function stripEphemeralAccessibilityRefs(markdown: string): string {
  return markdown.replace(/\s*\[ref=e\d+\]/gi, "");
}

function sanitizeAriaMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // El snapshot "ai" a veces incluye botones fantasma de overlays desmontados,
    // típicamente sin ref y sin metadata útil. Esto confunde al planner.
    const isGhostOverlayButton =
      /^-\s+button\s+"(Aceptar|Cancelar|OK|Ok|Cerrar)"\s*$/i.test(trimmed) &&
      !/\[ref=/.test(trimmed);
    if (isGhostOverlayButton) continue;
    out.push(stripEphemeralAccessibilityRefs(line));
  }
  return out.join("\n");
}

type DetectedInput = {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  text: string;
  visible: boolean;
};

async function detectFormInputs(page: Page): Promise<DetectedInput[]> {
  try {
    return await page.evaluate<DetectedInput[]>(() => {
      const isVisible = (el: Element): boolean => {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(he);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return true;
      };
      const elements = Array.from(
        document.querySelectorAll("input, textarea, select, button, [role=button], [role=textbox]"),
      ) as HTMLElement[];
      return elements.slice(0, 40).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? "",
        name: (el as HTMLInputElement).name ?? "",
        id: el.id,
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        autocomplete: (el as HTMLInputElement).autocomplete ?? "",
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        visible: isVisible(el),
      }));
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Capa 1 — Percepción: PageError (consola, red, DOM). Spec §4.1.
// ---------------------------------------------------------------------------

const REDACTED = "[REDACTED]";
const SENSITIVE_QUERY_KEYS = ["token", "apikey", "api_key", "secret", "password", "authorization", "auth"];

/** Redacta valores de query params sensibles (mismo criterio que `lib/redact-assist.ts` del lado API). */
function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    let redactedAny = false;
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.some((needle) => key.toLowerCase().includes(needle))) {
        parsed.searchParams.set(key, REDACTED);
        redactedAny = true;
      }
    }
    return redactedAny ? parsed.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}

function truncateMessage(message: string, max = 500): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Patrones de error típicos (es/en) para clasificar `role="alert"` visible como blocking. */
const DOM_ERROR_TEXT_RE = /error|fall[oó]|no se pudo|failed|falló|excepci[oó]n|exception|crash/i;

/**
 * Ruido inequívoco de dev-tooling (GHOST-66): fallos de WebSocket de HMR
 * (webpack/vite/react refresh) que el entorno de desarrollo del target emite
 * de forma recurrente. Lista conservadora — solo patrones que jamás indican
 * un bug de la app. Estos errores se capturan igual (contexto en snapshot y
 * dossier) pero NO deben disparar el trigger `error-signal` del juez.
 */
const HMR_WS_ENDPOINT_RE = /\/ws'? failed|sockjs-node|__vite_hmr|@vite\/client/i;
const DEV_TOOLING_RE = /\[HMR\]|\[webpack-dev-server\]|react refresh/i;

export function isKnownDevNoiseError(message: string): boolean {
  if (message.includes("WebSocket connection to") && HMR_WS_ENDPOINT_RE.test(message)) return true;
  return DEV_TOOLING_RE.test(message);
}

function classifyDomSeverity(role: string, text: string): PageErrorSeverity {
  if (role === "alert" || role === "alertdialog") {
    return DOM_ERROR_TEXT_RE.test(text) ? "blocking" : "warning";
  }
  return "warning";
}

function classifyNetworkSeverity(status: number): PageErrorSeverity {
  return status >= 500 ? "blocking" : "warning";
}

/** Same-origin (o subdominio del baseUrl); requests de terceros/analytics son ignorables por defecto. */
function isAllowedNetworkOrigin(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(baseUrl);
    return target.hostname === base.hostname || target.hostname.endsWith(`.${base.hostname}`);
  } catch {
    return false;
  }
}

type DetectedDomError = {
  role: string;
  text: string;
  selector: string;
};

async function detectDomErrors(page: Page): Promise<DetectedDomError[]> {
  try {
    return await page.evaluate<DetectedDomError[]>(() => {
      const isVisible = (el: Element): boolean => {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(he);
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
          return false;
        }
        return true;
      };
      const out: DetectedDomError[] = [];
      const seen = new Set<Element>();
      const pushFrom = (el: Element, selectorHint: string) => {
        if (seen.has(el) || !isVisible(el)) return;
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) return;
        seen.add(el);
        const role = (el.getAttribute("role") || (el.getAttribute("aria-live") ? "status" : "")).trim();
        out.push({ role, text: text.slice(0, 500), selector: selectorHint });
      };
      for (const el of Array.from(document.querySelectorAll('[role="alert"]'))) {
        pushFrom(el, '[role="alert"]');
      }
      for (const el of Array.from(document.querySelectorAll('[role="alertdialog"]'))) {
        pushFrom(el, '[role="alertdialog"]');
      }
      for (const el of Array.from(document.querySelectorAll('[aria-live="assertive"]'))) {
        pushFrom(el, '[aria-live="assertive"]');
      }
      return out.slice(0, 10);
    });
  } catch {
    return [];
  }
}

async function captureDomPageErrors(page: Page, observedAtStep: number): Promise<PageError[]> {
  const detected = await detectDomErrors(page);
  return detected.map((d) => ({
    source: "dom",
    severity: classifyDomSeverity(d.role, d.text),
    message: truncateMessage(d.text),
    detail: { selector: d.selector },
    observedAtStep,
  }));
}

export type PageErrorTrackerOptions = {
  /** URL base del run; delimita el allowlist same-origin para captura de red. */
  baseUrl: string;
};

export type PageErrorTracker = {
  /**
   * Devuelve los `PageError` de consola/red acumulados desde la última llamada
   * (ventana móvil por paso) y limpia el acumulador. `observedAtStep` se
   * asigna con el índice de paso recibido.
   */
  collectForStep: (stepIndex: number) => PageError[];
  /**
   * Historial ACUMULADO de todos los errores de consola/red del run, con su
   * `observedAtStep` original — no se vacía nunca. La ventana móvil de
   * `collectForStep` sirve para decisiones deterministas por paso (circuit
   * breaker), pero el dossier del juez necesita el historial completo: un
   * veredicto terminal (spec §4.3) invocado varios pasos después del error no
   * puede clasificar app-bug vs agent-lost si perdió la evidencia que lo probaba.
   */
  getHistory: () => PageError[];
};

/**
 * Adjunta listeners continuos de consola/red a la página (no por snapshot, spec §4.1 y §9:
 * los toasts efímeros desaparecen antes del snapshot, por eso consola/red son continuos).
 * Debe llamarse UNA vez por página/run.
 */
export function createPageErrorTracker(page: Page, options: PageErrorTrackerOptions): PageErrorTracker {
  const buffer: PageError[] = [];
  const history: PageError[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    buffer.push({
      source: "console",
      severity: "warning",
      message: truncateMessage(msg.text()),
      observedAtStep: -1,
    });
  });

  page.on("pageerror", (err) => {
    buffer.push({
      source: "console",
      severity: "blocking",
      message: truncateMessage(err instanceof Error ? err.message : String(err)),
      observedAtStep: -1,
    });
  });

  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (!isAllowedNetworkOrigin(url, options.baseUrl)) return;
    let method = "GET";
    try {
      method = res.request().method();
    } catch {
      // seguimos con GET por defecto
    }
    buffer.push({
      source: "network",
      severity: classifyNetworkSeverity(status),
      message: truncateMessage(`${method} ${redactUrl(url)} → ${status}`),
      detail: { url: redactUrl(url), status },
      observedAtStep: -1,
    });
  });

  return {
    collectForStep: (stepIndex: number) => {
      const collected = buffer.map((e) => ({ ...e, observedAtStep: stepIndex }));
      buffer.length = 0;
      history.push(...collected);
      return collected;
    },
    getHistory: () => history.slice(),
  };
}

async function detectVisibleDialogs(page: Page): Promise<VisibleDialogInfo[]> {
  try {
    return await page.evaluate<VisibleDialogInfo[]>(() => {
      const isVisible = (el: Element): boolean => {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(he);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const inView =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
          rect.left < (window.innerWidth || document.documentElement.clientWidth);
        return inView;
      };

      const out: VisibleDialogInfo[] = [];
      const seen = new Set<Element>();

      const pushFrom = (el: Element) => {
        if (seen.has(el) || !isVisible(el)) return;
        seen.add(el);
        const role = (el.getAttribute("role") || "").trim() || "dialog";
        const ariaLabel = (el.getAttribute("aria-label") || "").trim().slice(0, 200);
        const headings = Array.from(el.querySelectorAll("h1, h2, h3, h4, h5, h6"))
          .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const heading = headings[0]?.slice(0, 200) ?? "";
        out.push({
          role,
          ...(heading ? { heading } : {}),
          ...(ariaLabel ? { ariaLabel } : {}),
        });
      };

      for (const el of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))) {
        pushFrom(el);
      }
      for (const el of Array.from(document.querySelectorAll('[aria-modal="true"]'))) {
        pushFrom(el);
      }

      return out.slice(0, 8);
    });
  } catch {
    return [];
  }
}

function formatVisibleDialogsBlock(dialogs: VisibleDialogInfo[]): string {
  if (dialogs.length === 0) return "";
  const lines = dialogs.map((d, i) => {
    const bits = [`#${i + 1} role=${d.role}`];
    if (d.heading) bits.push(`título visible "${d.heading}"`);
    if (d.ariaLabel) bits.push(`aria-label="${d.ariaLabel}"`);
    return `- ${bits.join(" · ")}`;
  });
  return [
    "",
    "Diálogos / modales aparentemente VISIBLES ahora (comprobación DOM: tamaño, opacity, viewport):",
    ...lines,
    "Si el objetivo era abrir uno de estos y ya figura arriba, NO repitas clicks para «abrir» el mismo flujo: interactúa con el formulario o cierra sub-diálogos (p. ej. «OK» en avisos de mapas) antes de seguir.",
    "MODAL ABIERTO — alcance: interactúa solo con controles de este modal hasta cerrarlo o guardar; ignora listas/menús de la página de fondo salvo que el objetivo lo exija explícitamente.",
  ].join("\n");
}

type VisibleInteractiveRow = {
  tag: string;
  role: string;
  id: string;
  testid: string;
  aria: string;
  text: string;
};

/** Lista compacta de controles realmente visibles (isVisible) para desambiguar selectores sin copiar ref=. */
async function buildVisibleInteractivesBlock(page: Page): Promise<string> {
  try {
    const rows = await page.evaluate<VisibleInteractiveRow[]>(() => {
      const isVisible = (el: Element): boolean => {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(he);
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity || "1") === 0) {
          return false;
        }
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
      };
      const out: VisibleInteractiveRow[] = [];
      const sel =
        'button, [role="button"], a[href], [role="link"], h1, h2, h3, input, textarea, select, [role="combobox"]';
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (!isVisible(el)) continue;
        const he = el as HTMLElement;
        const tag = he.tagName.toLowerCase();
        const role = (he.getAttribute("role") || "").trim();
        const id = (he.id || "").trim().slice(0, 80);
        const testid = (he.getAttribute("data-testid") || "").trim().slice(0, 80);
        const aria = (he.getAttribute("aria-label") || "").trim().slice(0, 100);
        const text = (he.innerText || he.textContent || "").replace(/\s+/g, " ").trim().slice(0, 72);
        if (!id && !testid && !aria && text.length < 2) continue;
        out.push({ tag, role, id, testid, aria, text });
        if (out.length >= 50) break;
      }
      return out;
    });
    if (rows.length === 0) return "";
    const lines = rows.map((r) => {
      const bits: string[] = [r.tag + (r.role ? `[role=${r.role}]` : "")];
      if (r.id) bits.push(`#${r.id}`);
      if (r.testid) bits.push(`[data-testid=${JSON.stringify(r.testid)}]`);
      if (r.aria) bits.push(`aria-label=${JSON.stringify(r.aria)}`);
      if (r.text) bits.push(`text=${JSON.stringify(r.text)}`);
      return `- ${bits.join(" ")}`;
    });
    return [
      "",
      "INTERACTIVOS VISIBLES (DOM isVisible; úsalos para #id, [data-testid], aria-label antes que :has-text genérico):",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
}

function formatDetectedInputs(inputs: DetectedInput[]): string {
  const visibles = inputs.filter((i) => i.visible);
  if (visibles.length === 0) return "";
  const lines = visibles.map((i) => {
    const parts = [
      i.tag + (i.type ? `[type=${i.type}]` : ""),
      i.id ? `#${i.id}` : "",
      i.name ? `name=${i.name}` : "",
      i.placeholder ? `placeholder="${i.placeholder}"` : "",
      i.ariaLabel ? `aria-label="${i.ariaLabel}"` : "",
      i.autocomplete ? `autocomplete=${i.autocomplete}` : "",
      i.text ? `text="${i.text}"` : "",
    ].filter(Boolean);
    return `- ${parts.join(" ")}`;
  });
  return [
    "",
    "Controles de formulario visibles detectados por DOM:",
    "(cuando un selector por atributo sea ambiguo, prefiere el texto usando `:has-text(\"...\")` o `text=...`)",
    ...lines,
  ].join("\n");
}

async function waitForHydration(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 5_000 });
  } catch {
    // seguimos: algunas apps nunca llegan a networkidle
  }
}

/**
 * Captura un mapa semántico simplificado de la página.
 * Estrategia:
 *  1. Espera de hidratación (networkidle corto).
 *  2. ariaSnapshot inicial.
 *  3. Si el mapa es pobre (sin elementos interactivos), reintenta hasta 2 veces con pequeñas esperas
 *     para dar tiempo a SPAs que muestran loaders antes del contenido real.
 *  4. Anexa un bloque con inputs/botones visibles detectados por DOM para robustecer el prompt
 *     cuando `ariaSnapshot({ mode: "ai" })` colapsa nodos genéricos.
 */
export type CaptureObserverSnapshotOptions = {
  /** Tracker de errores de consola/red creado con `createPageErrorTracker` (opcional). */
  pageErrorTracker?: PageErrorTracker;
  /** Índice de paso actual, usado para etiquetar `observedAtStep` en los `pageErrors` recolectados. */
  stepIndex?: number;
};

export async function captureObserverSnapshot(
  page: Page,
  maxNodes = 300,
  opts: CaptureObserverSnapshotOptions = {},
): Promise<ObserverSnapshot> {
  await waitForHydration(page);

  let markdown = sanitizeAriaMarkdown(await ariaSnapshotSafe(page));
  let interactive = countInteractive(markdown);
  const minInteractive = 2;
  for (let attempt = 0; attempt < 2 && interactive < minInteractive; attempt += 1) {
    await page.waitForTimeout(1_500);
    try {
      await page.waitForLoadState("load", { timeout: 2_000 });
    } catch {
      // ignore
    }
    const next = sanitizeAriaMarkdown(await ariaSnapshotSafe(page));
    const nextInteractive = countInteractive(next);
    if (nextInteractive > interactive) {
      markdown = next;
      interactive = nextInteractive;
    }
  }

  const url = page.url();
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }

  const visibleInteractives = await buildVisibleInteractivesBlock(page);
  const detected = await detectFormInputs(page);
  const domBlock = formatDetectedInputs(detected);

  const visibleDialogs = await detectVisibleDialogs(page);
  const dialogBlock = formatVisibleDialogsBlock(visibleDialogs);

  const stepIndex = opts.stepIndex ?? -1;
  const domPageErrors = await captureDomPageErrors(page, stepIndex);
  const trackedPageErrors = opts.pageErrorTracker?.collectForStep(stepIndex) ?? [];
  const pageErrors = [...trackedPageErrors, ...domPageErrors];

  const combined = [visibleInteractives, markdown, domBlock, dialogBlock].filter(Boolean).join("\n");
  const { text, nodeCount } = countLines(combined, Math.max(20, maxNodes));
  return {
    url,
    title,
    capturedAt: new Date().toISOString(),
    treeMarkdown: text || "(sin mapa semántico disponible)",
    nodeCount,
    ...(visibleDialogs.length > 0 ? { visibleDialogs } : {}),
    pageErrors,
  };
}
