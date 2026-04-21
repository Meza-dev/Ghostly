/// <reference lib="dom" />
import type { Page } from "playwright";
import type { ObserverSnapshot, VisibleDialogInfo } from "./types.js";

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
export async function captureObserverSnapshot(
  page: Page,
  maxNodes = 300,
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

  const combined = [visibleInteractives, markdown, domBlock, dialogBlock].filter(Boolean).join("\n");
  const { text, nodeCount } = countLines(combined, Math.max(20, maxNodes));
  return {
    url,
    title,
    capturedAt: new Date().toISOString(),
    treeMarkdown: text || "(sin mapa semántico disponible)",
    nodeCount,
    ...(visibleDialogs.length > 0 ? { visibleDialogs } : {}),
  };
}
