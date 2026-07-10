import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Video } from "playwright";
import type { Locator } from "playwright";
import type { StepOutcome, RunResult } from "../run.js";
import type { Step } from "../schema.js";
import { captureObserverSnapshot, createPageErrorTracker } from "./observer.js";
import { sanitizeHealerSteps } from "./healer.js";
import {
  buildJudgeDossier,
  createJudgeContinueCapTracker,
  MAX_CONTINUE_VERDICTS_PER_REASON,
  validateJudgeVerdict,
} from "./judge.js";
import { redactOrTruncateText } from "./redaction.js";
import type {
  AssistEvent,
  AssistEventType,
  AssistedRunInput,
  HealerFn,
  JudgeDeterministicCheck,
  JudgeEvent,
  JudgeFn,
  JudgeTrigger,
  JudgeVerdict,
  ObserverSnapshot,
  PageError,
  PlanProgressItem,
  PlanProgressReportItem,
  StrategistFn,
  Verdict,
  VictoryCondition,
} from "./types.js";

export type AssistedRunResult = RunResult & {
  events: AssistEvent[];
  lastSnapshot?: ObserverSnapshot;
  learnedFlow?: Step[];
  finalPlan?: Step[];
  planProgress?: PlanProgressReportItem[];
  /** Taxonomía de veredictos (spec §5). Ausente hasta que una fase determinista o el juez lo produzcan. */
  verdict?: Verdict;
  /** Explicación del veredicto — descripción del check determinista o razonamiento del juez. */
  verdictReason?: string;
  /** Motivo interno de corte del loop (spec §6): `blocked-by-app-error`, `victory-met`, etc. */
  stopReason?: string;
  /** Evidencia dura que sustenta el veredicto (p. ej. los `PageError` que dispararon el circuit breaker). */
  verdictEvidence?: PageError[];
  /** Secuencia de invocaciones del juez (dossier resumido + veredicto) — observabilidad (spec §4.3). */
  judgeEvents?: JudgeEvent[];
};

export type AssistedDeps = {
  strategist: StrategistFn;
  healer: HealerFn;
  /**
   * El juez (Capa 3, spec §4.3) — mismo patrón de inyección que strategist/healer:
   * el runner NUNCA importa un LLM. La implementación real vive del lado API
   * (`createJudge`, GHOST-30); acá solo se consume vía el contrato de `judge.ts`.
   */
  judge: JudgeFn;
  log?: (message: string, details?: Record<string, unknown>) => void;
};

export type AssistedRunOptions = {
  signal?: AbortSignal;
};

function resolveUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const p = url.startsWith("/") ? url : `/${url}`;
  return new URL(p, baseUrl).href;
}

function stripAnsi(message: string): string {
  return message.replace(/\u001b\[[0-9;]*m/g, "");
}

function uniqSelectors(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksLikeBareKeyword(selector: string): boolean {
  const t = selector.trim();
  if (!t) return false;
  if (/[#\[\].:\s=]/.test(t)) return false;
  return /^[a-z0-9_-]+$/i.test(t);
}

function extractSelectorId(selector: string): string | null {
  const m = selector.match(/#([a-z0-9_-]+)/i);
  return m?.[1] ?? null;
}

function extractSelectorName(selector: string): string | null {
  const m = selector.match(/\[name\s*=\s*['"]?([^'"\]]+)['"]?\]/i);
  return m?.[1] ?? null;
}

function stripPlaceholderFilter(selector: string): string {
  return selector.replace(/\[placeholder\s*=\s*['"][^'"]*['"]\]/gi, "");
}

function stripLeadingDecorativeGlyphs(text: string): string {
  return text.replace(/^[^\p{L}\p{N}"']+/u, "").replace(/\s+/g, " ").trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLooseText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Muchas apps ponen ítems de submenú como `button` bajo `[role="menu"]` o dentro de `nav` (no `<a>`).
 * Evita que `getByRole("button").first()` elija un match oculto fuera del menú desplegable.
 */
async function tryMenuOrNavScopedButton(
  page: Page,
  label: string,
  timeout: number,
  mode: "click" | "visible",
): Promise<boolean> {
  const re = new RegExp(`^\\s*${escapeRegex(label.trim())}\\s*$`, "i");
  const timeoutMs = Math.min(timeout, 12_000);
  const roots = [page.locator(`[role="menu"]`), page.locator(`nav, [role="navigation"]`)];
  for (const root of roots) {
    try {
      const loc = root.getByRole("button", { name: re }).first();
      if (mode === "visible") {
        await loc.waitFor({ state: "visible", timeout: timeoutMs });
      } else {
        await loc.click({ timeout: timeoutMs });
      }
      return true;
    } catch {
      /* siguiente raíz */
    }
  }
  return false;
}

function escapeCssAttr(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** El LLM a veces emite `h3:text("…")` (no es CSS Playwright); lo mapeamos a heading:has-text. */
function normalizeLlmHeadingSelector(selector: string): string {
  const raw = selector.trim();
  const mText = raw.match(/^h([1-6]):text\((['"])([\s\S]*?)\2\)/i);
  if (mText?.[3] !== undefined) {
    const q = mText[2]!;
    return `heading:has-text(${q}${mText[3]}${q})`;
  }
  const mHas = raw.match(/^h([1-6]):has-text\((['"])([\s\S]*?)\2\)/i);
  if (mHas?.[3] !== undefined) {
    const q = mHas[2]!;
    return `heading:has-text(${q}${mHas[3]}${q})`;
  }
  return raw;
}

const REF_SELECTOR_RE = /\[\s*ref\s*=\s*e\d+\s*\]/i;

/** Los ref=eN del snapshot a11y no existen en el DOM como CSS; rechazamos para forzar replan. */
function assertNoAccessibilityRefSelector(primarySelector: string): void {
  if (REF_SELECTOR_RE.test(primarySelector)) {
    throw new Error(
      "Selector inválido: los tokens [ref=e…] del mapa de accesibilidad están prohibidos en el plan. " +
        "Usa #id, [name=…], [aria-label=…], [data-testid=…] o button:has-text(\"…\") según el bloque «INTERACTIVOS VISIBLES».",
    );
  }
}

function extractDataTestIdFromSelector(sel: string): string | null {
  const m = sel.match(/\[data-testid\s*=\s*["']([^"']+)["']\]/i);
  return m?.[1]?.trim() || null;
}

function hashDomSlice(page: Page): Promise<string> {
  return page
    .evaluate(() => (document.body?.innerHTML ?? "").slice(0, 16_000))
    .then((html) => createHash("sha256").update(html).digest("hex"));
}

async function countVisibleA11yDialogs(page: Page): Promise<number> {
  return page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count();
}

// HEALER-4 DEFERRED (accepted domain debt): these loader-text patterns are
// app-specific Spanish TMS strings. They are retained because no generic
// structural "loading/spinner visible" signal exists in observer.ts today
// (no aria-busy / role=progressbar / generic loading detector). Removing them
// would regress loop pacing with no replacement. Genericize in a follow-up
// slice that adds a structural loading-indicator detector to observer.ts, then
// route waitForKnownModalLoadersToFinish through it. Follow-up: HEALER-5.
/** Mensajes de carga frecuentes en modales (p. ej. TMS «Cargando documentos»). */
const MODAL_LOADER_TEXT_PATTERNS: RegExp[] = [
  /Cargando\s+documentos/i,
  /Cargando\s+remitos/i,
  /Loading\s+documents/i,
];

function modalLoaderBudgetMs(
  assist: NonNullable<AssistedRunInput["assist"]>,
  started: number,
  maxLoopMs: number,
): number {
  const configured = Math.max(3_000, assist.modalLoaderMaxWaitMs ?? 180_000);
  const remaining = Math.max(3_000, maxLoopMs - (Date.now() - started));
  return Math.min(configured, remaining);
}

/**
 * Si hay texto de carga visible (getByText), espera a state:hidden antes de seguir.
 * No-op si ningún patrón está visible (comprobación breve).
 */
async function waitForKnownModalLoadersToFinish(
  page: Page,
  maxMs: number,
  log: ((message: string, details?: Record<string, unknown>) => void) | undefined,
): Promise<void> {
  for (const re of MODAL_LOADER_TEXT_PATTERNS) {
    const loc = page.getByText(re).first();
    const visible = await loc.isVisible({ timeout: 800 }).catch(() => false);
    if (!visible) continue;
    log?.("assist/modal_loader_wait", { pattern: re.source, maxMs });
    await loc.waitFor({ state: "hidden", timeout: maxMs });
  }
}

async function victoryTargetVisible(page: Page, raw: string): Promise<boolean> {
  const s = raw.trim();
  if (!s) return false;
  if (/^text=/i.test(s)) {
    const t = stripLeadingDecorativeGlyphs(s.replace(/^text=\s*/i, "").replace(/^['"]|['"]$/g, ""));
    if (!t) return false;
    try {
      return await page.getByText(t, { exact: false }).first().isVisible({ timeout: 2_500 });
    } catch {
      return false;
    }
  }
  const cssHint =
    /^[#.\[]/.test(s) ||
    /:has-text|>>|\/\/|^\[|^[a-z0-9_-]+(\s*[>+~#.\[]|\s*,\s*)/i.test(s) ||
    /^role\s*=|^internal:/i.test(s);
  const looksLikeNaturalLanguage =
    !cssHint && (/[\s,;]/.test(s) || s.length > 40 || !/[#.\[\]=:]/.test(s));
  if (looksLikeNaturalLanguage) {
    try {
      return await page.getByText(s, { exact: false }).first().isVisible({ timeout: 2_500 });
    } catch {
      const body = normalizeLooseText((await page.textContent("body").catch(() => "")) ?? "");
      const cond = normalizeLooseText(s);
      if (!body || !cond) return false;
      if (body.includes(cond)) return true;
      const asksCreateToastAndTable =
        /toast|alerta|notific/.test(cond) && /creaci|crear|creado|guardad|exito/.test(cond) && /tabla|listado/.test(cond);
      if (asksCreateToastAndTable) {
        const hasSuccessSignal =
          /grupo creado exitosamente|creado exitosamente|guardado exitosamente|exito/.test(body);
        const hasRowSignal = /nueva calific/.test(body);
        return hasSuccessSignal && hasRowSignal;
      }
      return false;
    }
  }
  try {
    return await page.locator(s).first().isVisible({ timeout: 2_500 });
  } catch {
    return false;
  }
}

function expandFillSelectors(primary: string): string[] {
  const s = primary.trim();
  const lower = s.toLowerCase();
  const smartFirst: string[] = [];

  const mPh = s.match(/\[placeholder\s*=\s*["']([^"']+)["']\]/i);
  if (mPh?.[1]?.trim()) {
    smartFirst.push(`__gt:fill:placeholder=${encodeURIComponent(mPh[1].trim())}`);
  }
  const mPhStar = s.match(/\[placeholder\*=\s*["']([^"']+)["']\]/i);
  if (mPhStar?.[1]?.trim()) {
    smartFirst.push(`__gt:fill:placeholderPrefix=${encodeURIComponent(mPhStar[1].trim())}`);
  }

  const textEq = s.match(/^text=(.+)$/i)?.[1];
  if (textEq) {
    const clean = stripLeadingDecorativeGlyphs(textEq.replace(/^['"]|['"]$/g, "")).trim();
    if (clean) smartFirst.push(`__gt:fill:placeholder=${encodeURIComponent(clean)}`);
  }

  const tbHas = s.match(/^textbox:has-text\((['"])([\s\S]*?)\1\)/i);
  if (tbHas?.[2]) {
    const c = stripLeadingDecorativeGlyphs(tbHas[2]);
    if (c) smartFirst.push(`__gt:fill:textboxName=${encodeURIComponent(c)}`);
  }

  const out: string[] = [...smartFirst, s];

  // Relaja selectores frágiles con placeholder dinámico.
  const noPlaceholder = stripPlaceholderFilter(s).trim();
  if (noPlaceholder && noPlaceholder !== s) out.push(noPlaceholder);

  const id = extractSelectorId(s);
  if (id) {
    out.push(`#${id}`, `input#${id}`, `[id="${id}"]`, `input[id="${id}"]`);
  }
  const name = extractSelectorName(s);
  if (name) {
    out.push(`[name="${name}"]`, `input[name="${name}"]`, `textarea[name="${name}"]`);
  }

  if (lower.includes("username") || /name\s*=\s*['"]?\s*username/i.test(s) || /name\s*=\s*['"]?\s*user/i.test(s)) {
    out.push(
      'input[name="email"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[type="email"]',
      "#email",
      'input[id="email"]',
      "#user",
      'input[id="user"]',
    );
  }
  if (lower.includes("email") || /type\s*=\s*['"]email/i.test(s) || /name\s*=\s*['"]?\s*email/i.test(s)) {
    out.push(
      'input[name="username"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[type="text"]',
    );
  }
  if (lower.includes("password") || /type\s*=\s*['"]password/i.test(s) || /name\s*=\s*['"]?\s*password/i.test(s)) {
    out.push('input[type="password"]', 'input[name="password"]', "#password", 'input[id="password"]');
  }

  return uniqSelectors(out);
}

async function fillLocatorRobust(loc: Locator, value: string, timeout: number): Promise<void> {
  await loc.first().waitFor({ state: "visible", timeout: Math.min(12_000, timeout) });
  await loc.first().click({ timeout: Math.min(4_000, timeout) }).catch(() => {});
  await loc.first().fill(value, { timeout });
}

async function fillByPlaceholderSmart(page: Page, raw: string, value: string, timeout: number): Promise<void> {
  const needle = raw.trim();
  if (!needle) throw new Error("placeholder vacío");
  const reExact = new RegExp(`^\\s*${escapeRegex(needle)}\\s*$`, "i");
  const reLoose = new RegExp(escapeRegex(needle), "i");

  const tryOrder: Array<() => Locator> = [
    () => page.getByRole("dialog").getByPlaceholder(reExact),
    () => page.getByRole("dialog").getByPlaceholder(reLoose),
    () => page.locator('[role="dialog"]:visible').getByPlaceholder(reLoose),
    () => page.getByPlaceholder(reExact),
    () => page.getByPlaceholder(reLoose),
  ];
  let lastErr: unknown;
  for (const mk of tryOrder) {
    const loc = mk().first();
    try {
      await fillLocatorRobust(loc, value, timeout);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fillByPlaceholderPrefix(page: Page, prefix: string, value: string, timeout: number): Promise<void> {
  const pre = prefix.trim();
  if (!pre) throw new Error("prefijo placeholder vacío");
  const re = new RegExp(`^\\s*${escapeRegex(pre)}`, "i");
  const tryOrder: Array<() => Locator> = [
    () => page.getByRole("dialog").getByPlaceholder(re),
    () => page.getByPlaceholder(re),
  ];
  let lastErr: unknown;
  for (const mk of tryOrder) {
    try {
      await fillLocatorRobust(mk().first(), value, timeout);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fillByTextboxAccessibleName(page: Page, raw: string, value: string, timeout: number): Promise<void> {
  const name = raw.trim();
  if (!name) throw new Error("nombre textbox vacío");
  const re = new RegExp(escapeRegex(name), "i");
  const tryOrder: Array<() => Locator> = [
    () => page.getByRole("dialog").getByRole("textbox", { name: re }),
    () => page.getByRole("textbox", { name: re }),
  ];
  let lastErr: unknown;
  for (const mk of tryOrder) {
    try {
      await fillLocatorRobust(mk().first(), value, timeout);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fillWithSmartSelector(page: Page, selector: string, value: string, timeout: number): Promise<void> {
  const s = normalizeLlmHeadingSelector(selector.trim());

  const gtPh = s.match(/^__gt:fill:placeholder=(.+)$/i)?.[1];
  if (gtPh) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(gtPh);
    } catch {
      decoded = gtPh;
    }
    await fillByPlaceholderSmart(page, decoded, value, timeout);
    return;
  }

  const gtPfx = s.match(/^__gt:fill:placeholderPrefix=(.+)$/i)?.[1];
  if (gtPfx) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(gtPfx);
    } catch {
      decoded = gtPfx;
    }
    await fillByPlaceholderPrefix(page, decoded, value, timeout);
    return;
  }

  const gtTb = s.match(/^__gt:fill:textboxName=(.+)$/i)?.[1];
  if (gtTb) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(gtTb);
    } catch {
      decoded = gtTb;
    }
    await fillByTextboxAccessibleName(page, decoded, value, timeout);
    return;
  }

  const textEq = s.match(/^text=(.+)$/i)?.[1];
  if (textEq) {
    const clean = stripLeadingDecorativeGlyphs(textEq.replace(/^['"]|['"]$/g, "")).trim();
    if (clean) {
      try {
        await fillByPlaceholderSmart(page, clean, value, timeout);
        return;
      } catch {
        /* continuar */
      }
      await fillByTextboxAccessibleName(page, clean, value, timeout);
      return;
    }
  }

  const tbHas = s.match(/^textbox:has-text\((['"])([\s\S]*?)\1\)/i);
  if (tbHas?.[2]) {
    const clean = stripLeadingDecorativeGlyphs(tbHas[2]);
    if (clean) {
      await fillByTextboxAccessibleName(page, clean, value, timeout);
      return;
    }
  }

  await page.fill(s, value, { timeout });
}

function expandWaitSelectors(primary: string): string[] {
  const s = primary.trim();
  const lower = s.toLowerCase();
  const out: string[] = [s];
  const noPlaceholder = stripPlaceholderFilter(s).trim();
  if (noPlaceholder && noPlaceholder !== s) out.push(noPlaceholder);
  const id = extractSelectorId(s);
  if (id) out.push(`#${id}`, `input#${id}`, `[id="${id}"]`);
  const name = extractSelectorName(s);
  if (name) out.push(`[name="${name}"]`, `input[name="${name}"]`);
  if (looksLikeBareKeyword(s)) {
    out.push(
      `input[name="${s}"]`,
      `#${s}`,
      `[id="${s}"]`,
      `[data-testid="${s}"]`,
    );
  }
  if (lower.includes("role='navigation'") || lower.includes('role="navigation"') || lower.includes("navigation")) {
    out.push('[role="navigation"]', "nav");
  }
  // Mismos candidatos que en click (aria-label, text=, etc.) para waits sobre botones/enlaces.
  return uniqSelectors([...out, ...expandClickSelectors(s)]);
}

/**
 * Candidatos internos que fuerzan el PRIMER intento vía getByRole (no es CSS válido).
 * Así el log de fallos muestra explícitamente un intento por rol+nombre accesible antes que :has-text.
 */
function gtRoleFirstCandidates(s0: string): string[] {
  const out: string[] = [];
  const btn = s0.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i);
  if (btn?.[2]) {
    const c = stripLeadingDecorativeGlyphs(btn[2]);
    if (c) out.push(`__gt:role=button;name=${encodeURIComponent(c)}`);
  }
  const link = s0.match(/^a:has-text\((['"])([\s\S]*?)\1\)/i);
  if (link?.[2]) {
    const c = stripLeadingDecorativeGlyphs(link[2]);
    if (c) {
      out.push(`__gt:role=link;name=${encodeURIComponent(c)}`);
      out.push(`__gt:role=button;name=${encodeURIComponent(c)}`);
      const q = c.includes("'") ? '"' : "'";
      const inner = q === "'" ? c.replace(/'/g, "\\'") : c.replace(/"/g, '\\"');
      out.push(`button:has-text(${q}${inner}${q})`);
    }
  }
  if (out.length === 0) {
    const textOnly = s0.match(/^text=(.+)/i)?.[1];
    if (textOnly) {
      const c = stripLeadingDecorativeGlyphs(textOnly.replace(/^['"]|['"]$/g, ""));
      if (c) {
        const t = c.trim();
        out.push(`__gt:role=button;name=${encodeURIComponent(t)}`);
      }
    }
  }
  return out;
}

function expandClickSelectors(primary: string): string[] {
  const s0 = primary.trim().replace(/^link(?=\s*:)/i, "a");
  const lower = s0.toLowerCase();
  const out: string[] = [...gtRoleFirstCandidates(s0), s0];

  const aHas = s0.match(/^a:has-text\((['"])([\s\S]*?)\1\)/i);
  if (aHas?.[2]) {
    const c = stripLeadingDecorativeGlyphs(aHas[2]);
    if (c) {
      const q = c.includes("'") ? '"' : "'";
      const inner = q === "'" ? c.replace(/'/g, "\\'") : c.replace(/"/g, '\\"');
      out.push(`button:has-text(${q}${inner}${q})`);
    }
  }

  const hasText = s0.match(/:has-text\((['"])([\s\S]*?)\1\)/i);
  if (hasText?.[2]) {
    const cleaned = stripLeadingDecorativeGlyphs(hasText[2]);
    if (cleaned) {
      if (cleaned !== hasText[2]) {
        out.push(
          s0.replace(/:has-text\((['"])([\s\S]*?)\1\)/i, `:has-text("${cleaned}")`),
          `text=${cleaned}`,
        );
      }
      const cssText = escapeCssAttr(cleaned);
      out.push(
        `button[aria-label="${cssText}"]`,
        `button[aria-label*="${cssText}"]`,
        `[role="button"][aria-label="${cssText}"]`,
        `[role="button"][aria-label*="${cssText}"]`,
      );
    }
  }
  const tid = extractDataTestIdFromSelector(s0);
  if (tid) {
    const esc = escapeCssAttr(tid);
    out.push(`[data-testid="${esc}"]`, `[data-testid*="${esc}"]`);
  }
  const textEngine = s0.match(/^text=(.+)/i)?.[1];
  if (textEngine) {
    const cleaned = stripLeadingDecorativeGlyphs(textEngine.replace(/^['"]|['"]$/g, ""));
    if (cleaned) {
      const cssText = escapeCssAttr(cleaned);
      out.push(
        `button:has-text("${cleaned}")`,
        `button[aria-label="${cssText}"]`,
        `button[aria-label*="${cssText}"]`,
        `[role="button"][aria-label="${cssText}"]`,
        `[role="button"][aria-label*="${cssText}"]`,
      );
    }
  }

  if (
    lower.includes("submit") ||
    lower.includes("ingresar") ||
    lower.includes("entrar") ||
    lower.includes("login") ||
    lower.includes("sign in")
  ) {
    out.push(
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Ingresar")',
      "text=Ingresar",
      "text=Entrar",
    );
  }
  return uniqSelectors(out);
}

function selectorAttemptLabel(sel: string): string {
  const fillPh = sel.match(/^__gt:fill:placeholder=(.+)$/i);
  if (fillPh?.[1]) {
    try {
      return `getByPlaceholder(${JSON.stringify(decodeURIComponent(fillPh[1]))}) (dialog primero)`;
    } catch {
      return sel;
    }
  }
  const fillPfx = sel.match(/^__gt:fill:placeholderPrefix=(.+)$/i);
  if (fillPfx?.[1]) {
    try {
      return `getByPlaceholder(/^${decodeURIComponent(fillPfx[1])}/i) (dialog primero)`;
    } catch {
      return sel;
    }
  }
  const fillTb = sel.match(/^__gt:fill:textboxName=(.+)$/i);
  if (fillTb?.[1]) {
    try {
      return `getByRole('textbox', { name: /${decodeURIComponent(fillTb[1])}/i }) (dialog primero)`;
    } catch {
      return sel;
    }
  }
  const m = sel.match(/^__gt:role=(button|link);name=(.+)$/i);
  if (!m?.[1] || !m[2]) return sel;
  try {
    const name = decodeURIComponent(m[2]);
    return `getByRole('${m[1].toLowerCase()}', { name: /${name}/i })`;
  } catch {
    return sel;
  }
}

async function tryWithSelectorFallbacks(
  page: Page,
  label: "fill" | "click" | "waitForSelector",
  primarySelector: string,
  defaultTimeoutMs: number,
  expand: (sel: string) => string[],
  runOne: (page: Page, sel: string, timeout: number) => Promise<unknown>,
): Promise<void> {
  assertNoAccessibilityRefSelector(primarySelector);
  const candidates = expand(primarySelector);
  const firstTimeout = defaultTimeoutMs;
  const retryTimeout = Math.min(12_000, Math.max(3_000, Math.floor(defaultTimeoutMs / 3)));
  const attemptErrors: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const sel = candidates[i]!;
    assertNoAccessibilityRefSelector(sel);
    const timeout = i === 0 ? firstTimeout : retryTimeout;
    try {
      await runOne(page, sel, timeout);
      if (i > 0) {
        // eslint-disable-next-line no-console
        console.log(`[assist-runner] ${label}: selector alternativo OK`, {
          original: primarySelector,
          used: selectorAttemptLabel(sel),
        });
      }
      return;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      attemptErrors.push(`• ${selectorAttemptLabel(sel)} → ${stripAnsi(raw).slice(0, 220)}`);
    }
  }
  throw new Error(
    `No se pudo ejecutar ${label} con selector base "${primarySelector}". Intentos:\n${attemptErrors.join("\n")}`,
  );
}

async function waitForTargetVisible(page: Page, selector: string, timeout: number): Promise<void> {
  const s = normalizeLlmHeadingSelector(selector);
  const gt = s.match(/^__gt:role=(button|link);name=(.+)$/i);
  if (gt?.[1] && gt[2]) {
    let name: string;
    try {
      name = decodeURIComponent(gt[2]);
    } catch {
      name = gt[2];
    }
    const kind = gt[1].toLowerCase();
    if (kind === "button") {
      if (await tryMenuOrNavScopedButton(page, name, timeout, "visible")) return;
      await page
        .getByRole("button", { name: new RegExp(escapeRegex(name), "i") })
        .first()
        .waitFor({ state: "visible", timeout });
      return;
    }
    await page.getByRole("link", { name: new RegExp(escapeRegex(name), "i") }).first().waitFor({ state: "visible", timeout });
    return;
  }
  const headingText = s.match(/^heading:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (headingText) {
    const clean = stripLeadingDecorativeGlyphs(headingText);
    if (clean) {
      try {
        await page
          .getByRole("heading", { name: new RegExp(escapeRegex(clean), "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
    }
  }
  const buttonText = s.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (buttonText) {
    const clean = stripLeadingDecorativeGlyphs(buttonText);
    if (clean) {
      if (await tryMenuOrNavScopedButton(page, clean, timeout, "visible")) return;
      try {
        await page
          .getByRole("button", { name: new RegExp(escapeRegex(clean), "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar con CSS */
      }
      try {
        const cssText = escapeCssAttr(clean);
        await page
          .locator(
            `button[aria-label="${cssText}"], [role="button"][aria-label="${cssText}"], button[aria-label*="${cssText}"], [role="button"][aria-label*="${cssText}"]`,
          )
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
    }
  }
  const linkText = s.match(/^a:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (linkText) {
    const clean = stripLeadingDecorativeGlyphs(linkText);
    if (clean) {
      try {
        await page
          .getByRole("link", { name: new RegExp(escapeRegex(clean), "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
      if (await tryMenuOrNavScopedButton(page, clean, timeout, "visible")) return;
      try {
        await page
          .getByRole("button", { name: new RegExp(escapeRegex(clean), "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
    }
  }
  const textEngine = s.match(/^text=(.+)/i)?.[1];
  if (textEngine) {
    const clean = stripLeadingDecorativeGlyphs(textEngine.replace(/^['"]|['"]$/g, ""));
    if (clean) {
      try {
        await page.getByText(clean, { exact: false }).first().waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
    }
  }
  await page.waitForSelector(s, { state: "visible", timeout });
}

async function clickWithSmartSelector(page: Page, selector: string, timeout: number): Promise<void> {
  const s = normalizeLlmHeadingSelector(selector.trim());
  const gt = s.match(/^__gt:role=(button|link);name=(.+)$/i);
  if (gt?.[1] && gt[2]) {
    let name: string;
    try {
      name = decodeURIComponent(gt[2]);
    } catch {
      name = gt[2];
    }
    const kind = gt[1].toLowerCase();
    if (kind === "button") {
      if (await tryMenuOrNavScopedButton(page, name, timeout, "click")) return;
      await page.getByRole("button", { name: new RegExp(escapeRegex(name), "i") }).first().click({ timeout });
      return;
    }
    await page.getByRole("link", { name: new RegExp(escapeRegex(name), "i") }).first().click({ timeout });
    return;
  }
  const headingTextClick = s.match(/^heading:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (headingTextClick) {
    const clean = stripLeadingDecorativeGlyphs(headingTextClick);
    if (clean) {
      await page
        .getByRole("heading", { name: new RegExp(escapeRegex(clean), "i") })
        .first()
        .click({ timeout });
      return;
    }
  }
  const buttonText = s.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (buttonText) {
    const clean = stripLeadingDecorativeGlyphs(buttonText);
    if (clean) {
      if (await tryMenuOrNavScopedButton(page, clean, timeout, "click")) return;
      try {
        await page.getByRole("button", { name: new RegExp(escapeRegex(clean), "i") }).first().click({ timeout });
        return;
      } catch {
        // fallback a CSS/text engines
      }
      try {
        const cssText = escapeCssAttr(clean);
        await page
          .locator(
            `button[aria-label="${cssText}"], [role="button"][aria-label="${cssText}"], button[aria-label*="${cssText}"], [role="button"][aria-label*="${cssText}"]`,
          )
          .first()
          .click({ timeout });
        return;
      } catch {
        // fallback a CSS/text engines
      }
    }
  }
  const linkText = s.match(/^a:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (linkText) {
    const clean = stripLeadingDecorativeGlyphs(linkText);
    if (clean) {
      try {
        await page.getByRole("link", { name: new RegExp(escapeRegex(clean), "i") }).first().click({ timeout });
        return;
      } catch {
        // fallback a CSS
      }
      if (await tryMenuOrNavScopedButton(page, clean, timeout, "click")) return;
      try {
        await page.getByRole("button", { name: new RegExp(escapeRegex(clean), "i") }).first().click({ timeout });
        return;
      } catch {
        // fallback a CSS
      }
    }
  }
  const textEngine = s.match(/^text=(.+)/i)?.[1];
  if (textEngine) {
    const clean = stripLeadingDecorativeGlyphs(textEngine.replace(/^['"]|['"]$/g, ""));
    if (clean) {
      try {
        await page.getByText(clean, { exact: false }).first().click({ timeout });
        return;
      } catch {
        // fallback a CSS
      }
    }
  }
  await page.click(s, { timeout });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("run cancelado por el usuario");
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /abort|cancel/i.test(msg);
}

function runArtifactDir(baseDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return path.resolve(baseDir, `run-${stamp}-${suffix}`);
}

async function captureStepScreenshot(
  page: Page,
  artifactsDir: string,
  index: number,
  label: "ok" | "failed",
): Promise<string> {
  const filePath = path.join(artifactsDir, `step-${index + 1}-${label}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function applyStep(
  page: Page,
  baseUrl: string,
  step: Step,
  defaultTimeoutMs: number,
): Promise<void> {
  switch (step.action) {
    case "goto": {
      await page.goto(resolveUrl(baseUrl, step.url), {
        waitUntil: "domcontentloaded",
        timeout: defaultTimeoutMs,
      });
      return;
    }
    case "click": {
      const hashBefore = await hashDomSlice(page);
      const dialogsBefore = await countVisibleA11yDialogs(page);
      await tryWithSelectorFallbacks(
        page,
        "click",
        step.selector,
        defaultTimeoutMs,
        expandClickSelectors,
        (p, sel, t) => clickWithSmartSelector(p, sel, t),
      );
      await page.waitForTimeout(500);
      const hashAfter = await hashDomSlice(page);
      if (hashBefore === hashAfter) {
        const dialogsAfter = await countVisibleA11yDialogs(page);
        const creationOpened = dialogsAfter > dialogsBefore;
        if (creationOpened) {
          return;
        }
        throw new Error(
          "Click sin mutación detectable en el DOM (contenido estable). " +
            "El control podría estar deshabilitado, tapado por un modal, o el estado ya estaba aplicado.",
        );
      }
      return;
    }
    case "fill": {
      await tryWithSelectorFallbacks(
        page,
        "fill",
        step.selector,
        defaultTimeoutMs,
        expandFillSelectors,
        (p, sel, t) => fillWithSmartSelector(p, sel, step.value, t),
      );
      return;
    }
    case "press": {
      await page.keyboard.press(step.key);
      return;
    }
    case "waitForSelector": {
      const t = step.timeoutMs ?? defaultTimeoutMs;
      await tryWithSelectorFallbacks(
        page,
        "waitForSelector",
        step.selector,
        t,
        expandWaitSelectors,
        (p, sel, timeout) => waitForTargetVisible(p, sel, timeout),
      );
      return;
    }
    case "snapshot": {
      return;
    }
  }
}

function redactStepForEvent(step: Step): Record<string, unknown> {
  if (step.action === "fill") {
    const sensitive = /pass|password|secret|token|api[_-]?key/i.test(step.selector);
    return {
      action: "fill",
      selector: step.selector,
      value: sensitive ? "[REDACTED]" : step.value,
    };
  }
  return { ...step } as Record<string, unknown>;
}

function stepKey(step: Step): string {
  if (step.action === "goto") return `goto|${step.url.trim().toLowerCase()}`;
  if (step.action === "press") return `press|${step.key.trim().toLowerCase()}`;
  if (step.action === "snapshot") return "snapshot";
  if (step.action === "click" || step.action === "waitForSelector") {
    const selector = step.selector
      .trim()
      .replace(/\s+/g, " ")
      .replace(/^textbox(\[[^\]]+\])$/i, "$1")
      .toLowerCase();
    return `${step.action}|${selector}`;
  }
  const fillSelector = step.selector
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^textbox(\[[^\]]+\])$/i, "$1")
    .toLowerCase();
  return `fill|${fillSelector}|${step.value}`;
}

function flowDedupKey(step: Step): string {
  if (step.action === "goto") return `goto|${step.url.trim().toLowerCase()}`;
  if (step.action === "press") return `press|${step.key.trim().toLowerCase()}`;
  if (step.action === "snapshot") return "snapshot";
  if (step.action === "fill") {
    return `fill|${step.selector.trim().replace(/\s+/g, " ").toLowerCase()}`;
  }
  return `${step.action}|${step.selector.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function snapshotStateKey(snapshot: ObserverSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  const body = `${snapshot.url}\n${snapshot.title}\n${normalizeLooseText(snapshot.treeMarkdown).slice(0, 1200)}`;
  let hash = 2166136261;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${snapshot.url.toLowerCase()}|${snapshot.title.toLowerCase()}|${(hash >>> 0).toString(16)}`;
}

function hasSuccessfulHistoryStep(
  history: Array<{ step: Step; ok: boolean; error?: string }>,
  step: Step,
): boolean {
  const k = stepKey(step);
  return history.some((h) => h.ok && stepKey(h.step) === k);
}

function findFirstPendingPlanIndex(planProgress: PlanProgressItem[], step: Step): number {
  const k = stepKey(step);
  return planProgress.findIndex((p) => p.status === "pending" && stepKey(p.step) === k);
}

function toPlanProgressReport(planProgress: PlanProgressItem[]): PlanProgressReportItem[] {
  return planProgress.map((p) => ({
    status: p.status,
    step: redactStepForEvent(p.step),
    ...(p.source ? { source: p.source } : {}),
    ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
    ...(p.stepIndex !== undefined ? { stepIndex: p.stepIndex } : {}),
    ...(p.note ? { note: p.note } : {}),
    ...(p.stateChanged !== undefined ? { stateChanged: p.stateChanged } : {}),
  }));
}

function buildFinalGeneralPlan(planProgress: PlanProgressItem[], learnedFlow: Step[]): Step[] {
  const successfulByOrder = planProgress
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.status === "ok")
    .sort((a, b) => {
      const ai = a.p.stepIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.p.stepIndex ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.idx - b.idx;
    })
    .map(({ p }) => p.step);

  const candidate = successfulByOrder.length > 0 ? successfulByOrder : learnedFlow;
  const finalSteps: Step[] = [];
  for (const step of candidate) {
    if (step.action === "snapshot") continue;
    const meta = planProgress.find((p) => p.status === "ok" && stepKey(p.step) === stepKey(step));
    if (step.action === "waitForSelector" && meta?.stateChanged === false) continue;
    const key = flowDedupKey(step);
    const last = finalSteps[finalSteps.length - 1];
    if (last && flowDedupKey(last) === key) {
      finalSteps[finalSteps.length - 1] = step;
      continue;
    }
    finalSteps.push(step);
  }
  return finalSteps;
}

/** Fracaso consecutivo del mismo paso al final del historial (fuerza salir del bucle replan). */
function countConsecutiveFailuresAtEndForStep(
  history: Array<{ step: Step; ok: boolean; error?: string }>,
  step: Step,
): number {
  const k = stepKey(step);
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (stepKey(h.step) !== k) break;
    if (h.ok) break;
    n++;
  }
  return n;
}

function pushLearnedStep(flow: Step[], step: Step): void {
  const last = flow[flow.length - 1];
  if (last && stepKey(last) === stepKey(step)) return;
  flow.push(step);
}

function isAuthenticatedSidebarContext(snapshot?: ObserverSnapshot): boolean {
  if (!snapshot) return false;
  const hay = `${snapshot.url}\n${snapshot.title}\n${snapshot.treeMarkdown}`.toLowerCase();
  return (
    /\bnavigation\b/i.test(hay) &&
    (hay.includes("home") ||
      hay.includes("cerrar sesión") ||
      hay.includes("cerrar sesion") ||
      hay.includes("logout") ||
      hay.includes("sign out"))
  );
}

function isLoginLikeStep(step: Step): boolean {
  if (step.action === "fill") {
    const s = step.selector.toLowerCase();
    return /user|usuario|email|login|password|contrase/.test(s);
  }
  if (step.action === "click" || step.action === "waitForSelector") {
    const s = step.selector.toLowerCase();
    return /ingresar|entrar|sign in|login|button\[type=['"]?submit/.test(s);
  }
  return false;
}

function hasRecentLoginSuccess(history: Array<{ step: Step; ok: boolean; error?: string }>): boolean {
  return history.slice(-8).some((h) => h.ok && isLoginLikeStep(h.step));
}

function shouldDropStepInCurrentContext(
  step: Step,
  snapshot: ObserverSnapshot | undefined,
  history: Array<{ step: Step; ok: boolean; error?: string }>,
): boolean {
  if (!isAuthenticatedSidebarContext(snapshot)) return false;
  if (!isLoginLikeStep(step)) return false;
  return hasRecentLoginSuccess(history);
}

/** Texto del click/wait comparable con títulos de modal (sin espacios ni puntuación fuerte). */
function normalizeForDialogMatch(s: string): string {
  return stripLeadingDecorativeGlyphs(s)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00fc]/gi, "");
}

function extractTextualTargetFromStep(step: Step): string | null {
  if (step.action !== "click" && step.action !== "waitForSelector") return null;
  const sel = step.selector.trim();
  const btn = sel.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i);
  if (btn?.[2]) return stripLeadingDecorativeGlyphs(btn[2]).trim() || null;
  const link = sel.match(/^a:has-text\((['"])([\s\S]*?)\1\)/i);
  if (link?.[2]) return stripLeadingDecorativeGlyphs(link[2]).trim() || null;
  const txt = sel.match(/^text=(.+)/i)?.[1];
  if (txt) return stripLeadingDecorativeGlyphs(txt.replace(/^['"]|['"]$/g, "")).trim() || null;
  const al = sel.match(/\[aria-label\s*=\s*["']([^"']+)["']\]/i);
  if (al?.[1]) return stripLeadingDecorativeGlyphs(al[1]).trim() || null;
  return null;
}

/**
 * Evita click/wait redundantes para «abrir» cuando un dialog visible ya refleja la intención
 * (p. ej. wait click "Confirmar guardado" + título de dialog "Confirmar guardado").
 */
function shouldDropRedundantModalOpenClick(step: Step, snapshot: ObserverSnapshot | undefined): boolean {
  if ((step.action !== "click" && step.action !== "waitForSelector") || !snapshot?.visibleDialogs?.length) {
    return false;
  }
  const phrase = extractTextualTargetFromStep(step);
  if (!phrase) return false;
  const P = normalizeForDialogMatch(phrase);
  if (P.length < 6) return false;
  for (const d of snapshot.visibleDialogs) {
    const blob = normalizeForDialogMatch([d.heading, d.ariaLabel].filter(Boolean).join(" "));
    if (blob.length < 4) continue;
    if (blob.includes(P)) return true;
  }
  return false;
}

function stepUsesForbiddenAccessibilityRef(step: Step): boolean {
  if (step.action === "click" || step.action === "waitForSelector" || step.action === "fill") {
    return REF_SELECTOR_RE.test(step.selector);
  }
  return false;
}

function shouldDropPlannedStep(
  step: Step,
  snapshot: ObserverSnapshot | undefined,
  history: Array<{ step: Step; ok: boolean; error?: string }>,
): boolean {
  return (
    stepUsesForbiddenAccessibilityRef(step) ||
    shouldDropStepInCurrentContext(step, snapshot, history) ||
    shouldDropRedundantModalOpenClick(step, snapshot)
  );
}

function isLikelyTerminalAction(step: Step): boolean {
  if (step.action === "click") {
    const s = step.selector.toLowerCase();
    return /guardar|enviar|confirmar|submit|crear/.test(s);
  }
  if (step.action === "press") {
    return step.key.toLowerCase() === "enter";
  }
  return false;
}

function hasTerminalLock(
  history: Array<{ step: Step; ok: boolean; error?: string }>,
  step: Step,
): boolean {
  // El candado solo aplica al MISMO paso terminal ya exitoso (evita re-ejecutar el mismo
  // submit). Antes contaba CUALQUIER acción "terminal" por substring del selector, lo que
  // saltaba por error botones distintos: p. ej. "Nuevo cliente" (cliente-crear matchea
  // "crear") se descartaba tras el login-submit (matchea "submit").
  const k = stepKey(step);
  let lastTerminalOk = -1;
  for (let i = 0; i < history.length; i++) {
    const h = history[i]!;
    if (h.ok && isLikelyTerminalAction(h.step) && stepKey(h.step) === k) {
      lastTerminalOk = i;
    }
  }
  if (lastTerminalOk < 0) return false;
  for (let i = lastTerminalOk + 1; i < history.length; i++) {
    if (!history[i]!.ok) return false;
  }
  return true;
}

function hasEquivalentReplacementStep(failedStep: Step, healSteps: Step[]): boolean {
  return healSteps.some((healStep) => {
    if (healStep.action !== failedStep.action) return false;
    if (failedStep.action === "click" && healStep.action === "click") {
      return healStep.selector !== failedStep.selector;
    }
    if (failedStep.action === "fill" && healStep.action === "fill") {
      return healStep.selector !== failedStep.selector;
    }
    if (failedStep.action === "waitForSelector" && healStep.action === "waitForSelector") {
      return healStep.selector !== failedStep.selector;
    }
    if (failedStep.action === "goto" && healStep.action === "goto") {
      return healStep.url !== failedStep.url;
    }
    if (failedStep.action === "press" && healStep.action === "press") {
      return healStep.key !== failedStep.key;
    }
    return false;
  });
}

function hasPendingInputSteps(planProgress: PlanProgressItem[]): boolean {
  return planProgress.some((p) => p.source === "input" && p.status === "pending");
}

function hasGeneratedPlanActivity(planProgress: PlanProgressItem[]): boolean {
  return planProgress.some((p) => p.source === "strategist" || p.source === "replan" || p.source === "healer");
}

function looksLikeSeedInputPlan(steps: Step[]): boolean {
  if (steps.length !== 1) return false;
  const [first] = steps;
  if (!first || first.action !== "goto") return false;
  // Compara solo el pathname: un seed real es "ir a la raíz", con o sin query
  // string (p. ej. un harness de test que anexa `?scenario=...` a la home).
  const raw = first.url.trim();
  const pathname = raw.split(/[?#]/)[0]?.toLowerCase() ?? "";
  return pathname === "/" || pathname === "";
}

function looksLikeIncompleteLoginReplay(steps: Step[]): boolean {
  if (steps.length === 0) return false;
  let hasUserFill = false;
  let hasPasswordFill = false;
  let hasLoginClick = false;
  for (const step of steps) {
    if (step.action === "fill") {
      const s = step.selector.toLowerCase();
      if (/user|usuario|email|login/.test(s)) hasUserFill = true;
      if (/pass|password|contrase/.test(s)) hasPasswordFill = true;
    } else if (step.action === "click") {
      if (/ingresar|entrar|login|sign in/.test(step.selector.toLowerCase())) hasLoginClick = true;
    }
  }
  return hasUserFill && hasLoginClick && !hasPasswordFill;
}

/**
 * Circuit breaker de errores (Capa 2 — reglas duras, spec §4.2a).
 *
 * Correlaciona los `PageError` de severidad `blocking` con la acción recién
 * ejecutada: solo cuentan los observados en el paso actual o el inmediato
 * anterior (`currentStepIndex - 1`). Es una función pura y determinista —
 * no consulta al LLM — para que el corte del loop sea siempre reproducible.
 * Devuelve `undefined` cuando no hay evidencia correlacionada.
 */
export function detectBlockingAppError(
  pageErrors: PageError[],
  currentStepIndex: number,
): PageError[] | undefined {
  const correlated = pageErrors.filter(
    (e) =>
      e.severity === "blocking" &&
      (e.observedAtStep === currentStepIndex || e.observedAtStep === currentStepIndex - 1),
  );
  return correlated.length > 0 ? correlated : undefined;
}

/** Clave estable de un `PageError` para deduplicar cuáles ya se enviaron al juez (trigger `error-signal`). */
export function pageErrorKey(error: PageError): string {
  return `${error.source}|${error.severity}|${error.observedAtStep}|${error.message}`;
}

/**
 * Trigger `error-signal` (Capa 3, spec §4.3): `PageError` de severidad
 * `warning` correlacionados con la acción recién ejecutada que la Capa 2 NO
 * resolvió por sí sola (los `blocking` ya cortaron vía `detectBlockingAppError`
 * antes de llegar acá). `alreadyJudged` evita re-disparar el juez por el
 * mismo warning en cada paso subsiguiente — solo interesa el momento en que
 * aparece por primera vez.
 */
export function detectUnresolvedWarningSignal(
  pageErrors: PageError[],
  currentStepIndex: number,
  alreadyJudged: ReadonlySet<string>,
): PageError[] | undefined {
  const correlated = pageErrors.filter(
    (e) =>
      e.severity === "warning" &&
      (e.observedAtStep === currentStepIndex || e.observedAtStep === currentStepIndex - 1) &&
      !alreadyJudged.has(pageErrorKey(e)),
  );
  return correlated.length > 0 ? correlated : undefined;
}

/**
 * Victoria verificada (Capa 2 — reglas duras, spec §4.2b).
 *
 * La victoria se declara SOLO si las condiciones configuradas (URL, texto,
 * selector visible) pasan la verificación del motor sobre la página real
 * (`victoryTargetVisible`, que consulta el DOM vivo vía Playwright). Ya NO
 * hay una vía de heurística de substring sobre el snapshot estático como
 * atajo autónomo — eso era exactamente la causa raíz #4 de la spec (falso
 * éxito por heurística débil). Donde no hay condición configurada, el
 * llamador (`runAssistedFlow`) enruta al trigger del juez en lugar de
 * adivinar aquí.
 */
async function evaluateVictory(
  page: Page,
  snapshot: ObserverSnapshot,
  victory: NonNullable<AssistedRunInput["assist"]>["victory"] | undefined,
): Promise<{ configured: boolean; met: boolean; details: Record<string, unknown> }> {
  if (!victory) {
    return { configured: false, met: false, details: { reason: "not-configured" } };
  }

  const checks: boolean[] = [];
  const details: Record<string, unknown> = {};
  const haystack = `${snapshot.title}\n${snapshot.url}\n${snapshot.treeMarkdown}`.toLowerCase();

  if (victory.urlIncludes && victory.urlIncludes.length > 0) {
    const results = victory.urlIncludes.map((needle) => snapshot.url.toLowerCase().includes(needle.toLowerCase()));
    details.urlIncludes = results;
    checks.push(victory.mustAll ? results.every(Boolean) : results.some(Boolean));
  }
  if (victory.textIncludes && victory.textIncludes.length > 0) {
    const results = victory.textIncludes.map((needle) => haystack.includes(needle.toLowerCase()));
    details.textIncludes = results;
    checks.push(victory.mustAll ? results.every(Boolean) : results.some(Boolean));
  }
  if (victory.selectorVisible && victory.selectorVisible.length > 0) {
    const selectorResults: boolean[] = [];
    for (const selector of victory.selectorVisible) {
      selectorResults.push(await victoryTargetVisible(page, selector));
    }
    details.selectorVisible = selectorResults;
    checks.push(victory.mustAll ? selectorResults.every(Boolean) : selectorResults.some(Boolean));
  }

  const met = checks.length === 0 ? false : (victory.mustAll ? checks.every(Boolean) : checks.some(Boolean));
  return { configured: true, met, details };
}

/**
 * ¿El goal en lenguaje natural implica persistir estado (crear/guardar/enviar)?
 * Spec §4.2b: estos objetivos requieren el double-check de recarga antes de
 * aceptar la victoria — un guardado que no persiste no debe pasar como éxito.
 * Heurística conservadora por palabra clave en español (idioma del producto);
 * falsos negativos (goal de persistencia no detectado) son preferibles a
 * falsos positivos que recarguen flujos efímeros/multi-paso sin necesidad.
 */
export function goalImpliesPersistence(goal: string): boolean {
  const g = normalizeLooseText(goal);
  return /\b(crear|crea|guardar|guardo|guardó|enviar|envio|envió|confirmar|confirmo|confirmó|registrar|registro)\b/.test(
    g,
  );
}

/**
 * Decide si un candidato a victoria debe pasar por el double-check de recarga
 * (spec §4.2b). El opt-out explícito `victory.revalidate` siempre gana sobre
 * la heurística del goal — así flujos con estado efímero/multi-paso (wizards)
 * pueden declarar `revalidate: false` sin pelear contra la detección automática.
 */
export function shouldRevalidateVictory(
  goal: string,
  victory: VictoryCondition | undefined,
): boolean {
  if (victory?.revalidate !== undefined) return victory.revalidate;
  return goalImpliesPersistence(goal);
}

/**
 * Detector de estancamiento (Capa 2, spec §4.2c): dispara cuando el diff entre
 * snapshots consecutivos fue vacío/trivial durante `threshold` pasos seguidos
 * (default 3). Función pura sobre el contador que mantiene el loop — separada
 * para poder testearla sin Playwright.
 */
export function detectStall(consecutiveTrivialDiffs: number, threshold = 3): boolean {
  return consecutiveTrivialDiffs >= threshold;
}

/**
 * Redacta `verdictReason` EN LA FUENTE, antes de que salga del pipeline hacia
 * cualquier sink (spec §6, Kanon GHOST-31, fix C3).
 *
 * `verdictReason` se ensambla en varios puntos de `runAssistedFlow` a partir
 * de texto libre derivado del juez (`outcome.reasoning`, ya redactado en
 * `judgeEvents[]` vía `summarizeJudgeEventForPersistence`, pero NO en este
 * campo separado) y del `goal` del usuario interpolado directamente en
 * strings (p. ej. `el objetivo "${assist.goal}" implicaba...`). Dos leaks
 * previos (C1, C2) cerraron el payload del evento `judge_verdict`; este
 * campo es independiente y fluía sin redactar hacia `AssistedRunResult`,
 * desde ahí hacia el payload del evento `run_end`, `Run.verdictReason` (DB)
 * y `RunRecord.verdictReason` (API) — tres sinks distintos, un solo origen.
 *
 * Reusa el mismo contrato de redacción (`redactOrTruncateText`, spec §6)
 * usado por `judge.ts`, aplicado UNA VEZ acá para que todo consumidor de
 * `AssistedRunResult.verdictReason` reciba el valor ya saneado — en vez de
 * redactar cada sink por separado (lo que dejó pasar C1 y C2).
 */
export function redactVerdictReason(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return redactOrTruncateText(value);
}

/**
 * Redacta `verdictEvidence` EN LA FUENTE, antes de que salga del pipeline
 * hacia `AssistedRunResult` (W15, forward-carry del review de GHOST-31 —
 * Kanon GHOST-35).
 *
 * `verdictEvidence` es un `PageError[]` (evidencia dura del circuit breaker,
 * spec §4.2a) cuyo campo `.message` viene de texto de consola/DOM/red de la
 * PÁGINA BAJO PRUEBA (`observer.ts` — `truncateMessage`/`redactUrl` solo
 * truncan/redactan query params, NO pasan por el boundary de palabras
 * sensibles). En GHOST-31 este campo NO se persistía (`finalizeRun` no lo
 * consume), así que no era un leak activo — pero el momento en que
 * GHOST-32 (dashboard) lo exponga en la UI o en una respuesta de API se
 * vuelve un sink real. Se redacta acá, en el mismo choke point que
 * `verdictReason`, para que el campo llegue SIEMPRE seguro sin que la
 * slice de dashboard tenga que acordarse de hacerlo.
 */
export function redactVerdictEvidence(evidence: PageError[] | undefined): PageError[] | undefined {
  if (!evidence) return undefined;
  return evidence.map((entry) => ({
    ...entry,
    message: redactOrTruncateText(entry.message),
  }));
}

export async function runAssistedFlow(
  input: AssistedRunInput,
  deps: AssistedDeps,
  opts: AssistedRunOptions = {},
): Promise<AssistedRunResult> {
  const started = Date.now();
  const events: AssistEvent[] = [];
  const outcomes: StepOutcome[] = [];
  const history: Array<{ step: Step; ok: boolean; error?: string; healed?: boolean }> = [];

  const assist = input.assist;
  if (!assist || assist.v2 !== true) {
    throw new Error("runAssistedFlow requiere input.assist.v2=true");
  }
  const healingAttempts = Math.max(0, assist.maxHealingAttemptsPerStep ?? 1);
  const observerMaxNodes = Math.max(50, assist.observerMaxNodes ?? 300);
  const log = deps.log ?? (() => undefined);

  const shouldCaptureScreenshots = input.captureScreenshotAfterEachStep;
  const shouldRecordVideo = input.recordVideoOnFailure;
  const artifactsDir = shouldCaptureScreenshots || shouldRecordVideo
    ? runArtifactDir(input.artifactsDir)
    : undefined;

  let seq = 0;
  const emit = (
    type: AssistEventType,
    payload: Record<string, unknown>,
    stepIndex?: number,
  ) => {
    const evt: AssistEvent = {
      seq: seq++,
      type,
      at: new Date().toISOString(),
      ...(stepIndex !== undefined ? { stepIndex } : {}),
      payload,
    };
    events.push(evt);
    log(`assist/${type}`, { stepIndex, ...payload });
  };

  const browser = await chromium.launch({ headless: input.headless });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let pageVideo: Video | null = null;
  let runOk = true;
  let videoPath: string | undefined;
  let lastSnapshot: ObserverSnapshot | undefined;
  let aborted = false;
  const learnedFlow: Step[] = [];
  const planProgress: PlanProgressItem[] = [];
  let stopReason = "completed";
  let verdict: Verdict | undefined;
  let verdictReason: string | undefined;
  let verdictEvidence: PageError[] | undefined;
  const judgeEvents: JudgeEvent[] = [];
  const judgeContinueCap = createJudgeContinueCapTracker();
  let previousJudgeSnapshot: ObserverSnapshot | undefined;
  /** Pista del último veredicto `continue` del juez — consumida por el próximo pedido al strategist, luego limpiada. */
  let judgeHint: string | undefined;
  /** `PageError` de severidad warning ya enviados al juez (trigger `error-signal`) — evita re-disparar por el mismo error en cada paso. */
  const judgedWarningKeys = new Set<string>();

  try {
    throwIfAborted(opts.signal);
    if (artifactsDir) {
      await mkdir(artifactsDir, { recursive: true });
    }
    context = await browser.newContext(
      shouldRecordVideo && artifactsDir
        ? { recordVideo: { dir: artifactsDir } }
        : undefined,
    );
    page = await context.newPage();
    pageVideo = page.video();
    page.setDefaultTimeout(input.defaultTimeoutMs);
    // Listeners continuos de consola/red (Capa 1 — percepción, spec §4.1): se adjuntan una
    // sola vez por página; los toasts/errores efímeros no sobreviven hasta el próximo snapshot.
    const pageErrorTracker = createPageErrorTracker(page, { baseUrl: input.baseUrl });
    const onAbort = () => {
      aborted = true;
      void context?.close().catch(() => undefined);
      void browser.close().catch(() => undefined);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Paso inicial implícito: ir a baseUrl.
    throwIfAborted(opts.signal);
    await page.goto(input.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: input.defaultTimeoutMs,
    });

    // Recon inicial
    lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, { pageErrorTracker, stepIndex: -1 });
    emit("recon", {
      url: lastSnapshot.url,
      title: lastSnapshot.title,
      nodeCount: lastSnapshot.nodeCount,
      treeMarkdown: lastSnapshot.treeMarkdown,
    });

    const maxHorizons = Math.max(1, assist.maxHorizons ?? 1);
    const stepsPerHorizon = Math.max(1, assist.stepsPerHorizon ?? 3);
    const maxLoopMs = Math.max(10_000, assist.maxLoopMs ?? 300_000);
    const memoryMode = assist.memoryMode ?? "runtime";
    const isFullPlan = assist.isFullPlan === true;
    const isSeedInputForFullPlan = isFullPlan && looksLikeSeedInputPlan(input.steps);
    const replaySeed = assist.seedMemorySteps ?? [];
    const replayFromMemory = Boolean(assist.replayFromMemory && replaySeed.length > 0);
    const replayIsSafe = !looksLikeIncompleteLoginReplay(replaySeed);
    const effectiveReplay = replayFromMemory && replayIsSafe;

    const pendingSteps: Step[] = effectiveReplay
      ? [...replaySeed]
      : [...input.steps];
    planProgress.push(...pendingSteps.map((step): PlanProgressItem => ({
      step,
      status: "pending",
      source: effectiveReplay ? "seed" : "input",
    })));
    let strategistHasMore = assist.replayFromMemory ? true : pendingSteps.length === 0;
    let nextStepIndex = 0;
    let horizon = 0;
    let victoryMet = false;
    let healerWasInvoked = false;
    // Capa 2 — detector de estancamiento (spec §4.2c): cuenta diffs de snapshot
    // triviales/vacíos consecutivos tras un paso ejecutado con éxito. Se resetea
    // en cuanto el estado cambia. `detectStall` decide el umbral (default N=3).
    let consecutiveTrivialDiffs = 0;
    const stalledThreshold = 3;
    const runtimeMemory: Step[] = [];
    const runtimeMemoryKeys = new Set<string>();
    for (const seed of assist.seedMemorySteps ?? []) {
      const key = stepKey(seed);
      if (runtimeMemoryKeys.has(key)) continue;
      runtimeMemoryKeys.add(key);
      runtimeMemory.push(seed);
    }

    if (pendingSteps.length > 0) {
      emit("plan_chunk", {
        steps: pendingSteps.map(redactStepForEvent),
        planProgress: planProgress.map((p) => ({
          status: p.status,
          source: p.source,
          step: redactStepForEvent(p.step),
          ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
          ...(p.stepIndex !== undefined ? { stepIndex: p.stepIndex } : {}),
        })),
        ...(replayFromMemory ? { source: effectiveReplay ? "memory" : "memory-rejected" } : {}),
        hasMore: false,
      });
    }

    // Capa 2 — circuit breaker (spec §4.2a): corte determinista por código, sin LLM.
    // Autoridad: evidencia determinista > juez > strategist — se evalúa ANTES que la
    // victoria en cada punto de chequeo post-paso, así un 500/crash nunca queda
    // enmascarado por una condición de victoria que coincida por accidente.
    const checkCircuitBreaker = (
      snapshot: ObserverSnapshot,
      stepIndex: number,
    ): { tripped: boolean; evidence?: PageError[] } => {
      const evidence = detectBlockingAppError(snapshot.pageErrors, stepIndex);
      if (!evidence) return { tripped: false };
      // `evidence[].message` viene de texto crudo de la página (consola/DOM/red,
      // ver `observer.ts`) — este evento SÍ se persiste vía el log-bridge, así
      // que pasa por el boundary de redacción antes de salir (GHOST-35, mismo
      // gap que W15 pero en un sink ya activo, no latente).
      emit(
        "loop_state",
        { state: "circuit_breaker_tripped", stepIndex, evidence: redactVerdictEvidence(evidence) },
        stepIndex,
      );
      return { tripped: true, evidence };
    };

    // Capa 2 — double-check de persistencia (spec §4.2b): tras un candidato a
    // victoria en un goal que implica persistir estado, re-navega a la vista base
    // (GET fresco, no `page.reload()`) y re-verifica la MISMA condición
    // configurada. Si no sobrevive, el dato nunca se persistió: es evidencia dura
    // e inequívoca de un bug de la app (simétrico al 5xx del circuit breaker), no
    // una victoria — y tampoco zona gris para el juez. Devuelve `undefined`
    // cuando no aplica revalidar (goal no implica persistencia, o
    // `revalidate: false` explícito).
    //
    // Nota deliberada: NO usamos `page.reload()`. Tras un submit de formulario
    // (`method="post"`), Playwright deja `page.url()` apuntando a la URL de
    // destino del POST (p. ej. `/save?...`); un `reload()` ahí re-ejecuta el
    // POST y "revalida" contra su propia respuesta optimista — nunca detecta
    // un guardado no persistente. Navegar de nuevo a `baseUrl` (GET) es la
    // única forma de consultar el estado real del servidor.
    const revalidateVictoryIfNeeded = async (
      stepIndex: number,
    ): Promise<{ survived: boolean } | undefined> => {
      if (!shouldRevalidateVictory(assist.goal, assist.victory)) return undefined;
      emit("loop_state", { state: "revalidating_persistence", stepIndex }, stepIndex);
      await page!.goto(input.baseUrl, { waitUntil: "domcontentloaded", timeout: input.defaultTimeoutMs });
      const reloadedSnapshot = await captureObserverSnapshot(page!, observerMaxNodes, {
        pageErrorTracker,
        stepIndex,
      });
      lastSnapshot = reloadedSnapshot;
      const revalidated = await evaluateVictory(page!, reloadedSnapshot, assist.victory);
      return { survived: revalidated.met };
    };

    const checkImmediateVictory = async (
      stepIndex: number,
      horizonNo: number,
      snapshotOverride?: ObserverSnapshot,
    ): Promise<{ decision: "continue" | "success" | "fail"; reason?: string; verdict?: Verdict }> => {
      if (snapshotOverride) {
        lastSnapshot = snapshotOverride;
      } else {
        await waitForKnownModalLoadersToFinish(page!, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
        lastSnapshot = await captureObserverSnapshot(page!, observerMaxNodes, {
          pageErrorTracker,
          stepIndex,
        });
      }
      const victory = assist.victory
        ? await evaluateVictory(page!, lastSnapshot, assist.victory)
        : { configured: false, met: false, details: { reason: "not-configured" } };
      const pendingInput = hasPendingInputSteps(planProgress);
      const awaitingSeedExpansion = isSeedInputForFullPlan && !healerWasInvoked && !hasGeneratedPlanActivity(planProgress);
      emit(
        "victory_check",
        {
          horizon: horizonNo,
          immediate: true,
          isFullPlan,
          pendingInputSteps: pendingInput,
          awaitingSeedExpansion,
          healerWasInvoked,
          victoryConfig: assist.victory ?? null,
          ...victory.details,
          configured: victory.configured,
          met: victory.met,
        },
        stepIndex,
      );
      if (victory.met) {
        if (isFullPlan && !healerWasInvoked && (pendingInput || awaitingSeedExpansion)) {
          return { decision: "continue", reason: "victory-deferred-full-plan" };
        }
        const revalidation = await revalidateVictoryIfNeeded(stepIndex);
        if (revalidation && !revalidation.survived) {
          // `assist.goal` es texto libre del usuario — este evento se
          // persiste vía el log-bridge, así que pasa por el boundary antes
          // de salir (GHOST-35 audit: leak no detectado por C1/C2/C3, que
          // solo auditaron el payload de `judge_verdict` y `verdictReason`).
          emit(
            "loop_state",
            { state: "persistence_check_failed", stepIndex, goal: redactOrTruncateText(assist.goal) },
            stepIndex,
          );
          return {
            decision: "fail",
            reason: "persistence-check-failed",
            verdict: "fail-app-bug",
          };
        }
        return { decision: "success", reason: "victory-met" };
      }
      return { decision: "continue" };
    };

    // Capa 3 — el juez (spec §4.3): invocado por eventos en los 5 triggers
    // exhaustivos de la tabla (error-signal, victory-candidate, stalled,
    // healing-exhausted, budget-exhausted). Autoridad: evidencia determinista
    // > juez > strategist — este helper solo se llama en los puntos donde la
    // Capa 2 ya agotó lo que puede decidir gratis. Construye el dossier,
    // valida el veredicto (Zod + reintento único), aplica el cap de 2
    // `continue` por motivo, y registra el evento para observabilidad.
    const invokeJudge = async (
      reason: JudgeTrigger,
      stepIndex: number,
      deterministicChecks: JudgeDeterministicCheck[] = [],
    ): Promise<JudgeVerdict> => {
      // El runner SIEMPRE captura el buffer del screenshot (best-effort, en
      // memoria — no toca `artifactsDir` ni requiere `shouldCaptureScreenshots`,
      // que gatean los artefactos por paso, no la evidencia del juez). Enviarlo
      // o no al LLM es 100% decisión de la capa API según capacidad del
      // provider (spec §4.3 "híbrido"); si falla la captura (página cerrada,
      // navegación en curso), se degrada a "sin screenshot" en vez de romper
      // la invocación del juez.
      let screenshot: Buffer | undefined;
      try {
        screenshot = await page!.screenshot({ fullPage: true });
      } catch {
        screenshot = undefined;
      }
      // El dossier del juez recibe el historial ACUMULADO de errores del run
      // (no solo la ventana móvil del último snapshot). Un veredicto terminal
      // invocado varios pasos después del error (p.ej. `budget-exhausted`) no
      // puede distinguir fail-app-bug de fail-agent-lost si perdió el 5xx/422
      // que lo probaba. Se deduplica contra los errores DOM del snapshot actual
      // (que no pasan por el tracker de consola/red). Cada error conserva su
      // `observedAtStep`, así el juez razona la temporalidad.
      const judgePageErrors: PageError[] = [];
      const seenPageErrorKeys = new Set<string>();
      for (const err of [...pageErrorTracker.getHistory(), ...lastSnapshot!.pageErrors]) {
        const key = pageErrorKey(err);
        if (seenPageErrorKeys.has(key)) continue;
        seenPageErrorKeys.add(key);
        judgePageErrors.push(err);
      }
      const dossier = buildJudgeDossier({
        goal: assist.goal,
        victoryCondition: assist.victory,
        reason,
        history,
        currentSnapshot: lastSnapshot!,
        previousSnapshot: previousJudgeSnapshot,
        pageErrors: judgePageErrors,
        deterministicChecks,
        ...(screenshot ? { screenshot } : {}),
      });
      previousJudgeSnapshot = lastSnapshot;
      emit("loop_state", { state: "judge_invoked", reason, stepIndex }, stepIndex);
      let outcome = await validateJudgeVerdict(() => deps.judge(dossier));
      if (outcome.verdict === "continue" && !judgeContinueCap.canContinue(reason)) {
        // 3ra invocación por el mismo motivo (spec §4.3 regla 5): el juez ya
        // no puede seguir pateando el problema — se fuerza un veredicto
        // terminal en vez de propagar un `continue` que excede el cap.
        outcome = {
          verdict: "inconclusive",
          confidence: "low",
          reasoning:
            `El juez propuso "continue" por el motivo "${reason}" por 3ra vez consecutiva; ` +
            `el cap de ${MAX_CONTINUE_VERDICTS_PER_REASON} intervenciones por motivo (spec §4.3) ` +
            "fuerza un veredicto terminal en vez de seguir reintentando.",
          evidence: outcome.evidence,
        };
      } else if (outcome.verdict === "continue") {
        judgeContinueCap.recordContinue(reason);
      }
      judgeEvents.push({
        reason,
        dossierSummary: {
          goal: dossier.goal,
          reason: dossier.reason,
          recentActionsCount: dossier.recentActions.length,
          pageErrorsCount: dossier.pageErrors.length,
        },
        verdict: outcome,
        at: new Date().toISOString(),
      });
      emit(
        "loop_state",
        { state: "judge_verdict", reason, stepIndex, verdict: outcome.verdict, confidence: outcome.confidence },
        stepIndex,
      );
      return outcome;
    };

    /**
     * Traduce un veredicto terminal del juez a los campos de resultado del
     * run. `verdict: "success"` es legítimo (spec §4.3, regla 2 — el juez
     * puede declarar éxito SI cita evidencia que lo prueba) y debe reflejarse
     * como `runOk = true`; cualquier otro veredicto terminal es un fallo.
     * Bug corregido en Fase 3b (GHOST-30): antes SIEMPRE forzaba `runOk =
     * false`, contradiciendo `verdict === "success"` y rompiendo el guardia
     * de memoria del lado API (spec §6, `run.ts`), que depende de que
     * `ok`/`verdict` sean consistentes entre sí.
     */
    const applyTerminalJudgeVerdict = (outcome: JudgeVerdict): void => {
      runOk = outcome.verdict === "success";
      verdict = outcome.verdict as Verdict;
      verdictReason = outcome.reasoning;
      stopReason = "judge-terminal-verdict";
      pendingSteps.length = 0;
      strategistHasMore = false;
    };

    while (runOk && (Date.now() - started) < maxLoopMs && horizon < maxHorizons) {
      throwIfAborted(opts.signal);
      horizon += 1;
      emit("horizon_start", { horizon, pendingSteps: pendingSteps.length });

      if (pendingSteps.length === 0) {
        const awaitingSeedExpansion = isSeedInputForFullPlan &&
          !healerWasInvoked &&
          !hasGeneratedPlanActivity(planProgress);
        if (isFullPlan && !awaitingSeedExpansion) {
          let judgeAllowedContinue = false;
          if (!assist.victory) {
            // Sin condición de victoria configurada, el desenlace SIEMPRE lo
            // decide el juez (spec §4.2b) — nunca "plan consumido" implícito.
            const stopIndex = nextStepIndex - 1;
            const outcome = await invokeJudge("victory-candidate", stopIndex, [
              { check: "victory.configured", passed: false },
            ]);
            if (outcome.verdict === "continue") {
              judgeHint = outcome.hint;
              judgeAllowedContinue = true;
            } else {
              applyTerminalJudgeVerdict(outcome);
              break;
            }
          }
          stopReason = "full-plan-consumed";
          if (!judgeAllowedContinue) break;
        }
        emit("loop_state", { state: "planning", horizon });
        await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
        lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
          pageErrorTracker,
          stepIndex: nextStepIndex,
        });
        const chunk = await deps.strategist({
          goal: assist.goal,
          baseUrl: input.baseUrl,
          snapshot: lastSnapshot,
          victory: assist.victory,
          history,
          planProgress,
          maxSteps: stepsPerHorizon,
          ...(judgeHint ? { judgeHint } : {}),
        });
        judgeHint = undefined;
        strategistHasMore = chunk.hasMore;
        const dropped: Step[] = [];
        for (const ps of chunk.steps) {
          if (hasSuccessfulHistoryStep(history, ps.step)) {
            dropped.push(ps.step);
            planProgress.push({
              step: ps.step,
              status: "dropped",
              source: "strategist",
              horizon,
              note: "already-successful",
            });
            continue;
          }
          if (shouldDropPlannedStep(ps.step, lastSnapshot, history)) {
            dropped.push(ps.step);
            planProgress.push({
              step: ps.step,
              status: "dropped",
              source: "strategist",
              horizon,
              note: "context-drop",
            });
            continue;
          }
          pendingSteps.push(ps.step);
          planProgress.push({ step: ps.step, status: "pending", source: "strategist", horizon });
        }
        emit("plan_chunk", {
          horizon,
          steps: chunk.steps.map((s) => redactStepForEvent(s.step)),
          droppedSteps: dropped.map(redactStepForEvent),
          planProgress: planProgress.slice(-120).map((p) => ({
            status: p.status,
            source: p.source,
            step: redactStepForEvent(p.step),
            ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
            ...(p.stepIndex !== undefined ? { stepIndex: p.stepIndex } : {}),
            ...(p.note ? { note: p.note } : {}),
          })),
          hasMore: chunk.hasMore,
        });

        if (pendingSteps.length === 0) {
          if (memoryMode !== "off" && runtimeMemory.length > 0) {
            emit("memory_hit", {
              horizon,
              candidates: runtimeMemory.length,
              source: assist.seedMemorySteps && assist.seedMemorySteps.length > 0 ? "durable" : "runtime",
            });
            for (const memStep of runtimeMemory.slice(0, stepsPerHorizon)) {
              if (hasSuccessfulHistoryStep(history, memStep)) continue;
              pendingSteps.push(memStep);
              planProgress.push({
                step: memStep,
                status: "pending",
                source: "seed",
                horizon,
                note: "memory-replay",
              });
            }
          } else {
            emit("memory_miss", { horizon });
            if (!assist.victory) {
              // Sin condición de victoria configurada, el desenlace SIEMPRE lo
              // decide el juez (spec §4.2b) — nunca "sin más pasos" implícito.
              const outcome = await invokeJudge("victory-candidate", nextStepIndex - 1, [
                { check: "victory.configured", passed: false },
              ]);
              if (outcome.verdict === "continue") {
                judgeHint = outcome.hint;
                // Sin pasos pendientes ni memoria: el próximo horizonte vuelve
                // a pedir plan al strategist con el hint del juez como contexto.
              } else {
                applyTerminalJudgeVerdict(outcome);
                break;
              }
            } else {
              stopReason = "no-steps-generated";
              runOk = false;
              break;
            }
          }
        }
      }

      emit("loop_state", { state: "executing", horizon });
      const horizonSteps = pendingSteps.splice(0, stepsPerHorizon);
      for (const step of horizonSteps) {
        throwIfAborted(opts.signal);
        const index = nextStepIndex++;
        emit("step_start", { step: redactStepForEvent(step) }, index);
        if (hasSuccessfulHistoryStep(history, step)) {
          const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
          if (pendingIdx >= 0) {
            planProgress[pendingIdx] = {
              ...planProgress[pendingIdx]!,
              status: "dropped",
              stepIndex: index,
              note: "skipped-already-successful",
            };
          }
          emit(
            "step_success",
            {
              step: redactStepForEvent(step),
              skipped: true,
              reason: "already-successful",
            },
            index,
          );
          continue;
        }
        if (isLikelyTerminalAction(step) && hasTerminalLock(history, step)) {
          const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
          if (pendingIdx >= 0) {
            planProgress[pendingIdx] = {
              ...planProgress[pendingIdx]!,
              status: "dropped",
              stepIndex: index,
              note: "terminal-lock-after-success",
            };
          }
          emit(
            "step_success",
            {
              step: redactStepForEvent(step),
              skipped: true,
              reason: "terminal-lock-after-success",
            },
            index,
          );
          continue;
        }
        try {
          const stateBefore = snapshotStateKey(lastSnapshot);
          if (
            (step.action === "click" || step.action === "waitForSelector") &&
            countConsecutiveFailuresAtEndForStep(history, step) >= 2
          ) {
            throw new Error(
              "Action Fatigue: este click/wait con el mismo selector ya falló 2+ veces seguidas al final del historial; " +
                "no se reintenta hasta que el planner proponga otro selector.",
            );
          }
          await applyStep(page, input.baseUrl, step, input.defaultTimeoutMs);
          let screenshotPath: string | undefined;
          if (shouldCaptureScreenshots && artifactsDir) {
            screenshotPath = await captureStepScreenshot(page, artifactsDir, index, "ok");
          }
          outcomes.push({
            index,
            action: step.action,
            ok: true,
            ...(screenshotPath ? { screenshotPath } : {}),
          });
          history.push({ step, ok: true });
          const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
          if (pendingIdx >= 0) {
            planProgress[pendingIdx] = {
              ...planProgress[pendingIdx]!,
              status: "ok",
              stepIndex: index,
            };
          } else {
            planProgress.push({ step, status: "ok", source: "strategist", horizon, stepIndex: index });
          }
          pushLearnedStep(learnedFlow, step);
          if (memoryMode !== "off") {
            const key = stepKey(step);
            if (!runtimeMemoryKeys.has(key)) {
              runtimeMemoryKeys.add(key);
              runtimeMemory.push(step);
            }
          }
          emit(
            "step_success",
            {
              step: redactStepForEvent(step),
              ...(screenshotPath ? { screenshotPath } : {}),
            },
            index,
          );
          await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
          lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
            pageErrorTracker,
            stepIndex: index,
          });
          const stateAfter = snapshotStateKey(lastSnapshot);
          const stateChanged = stateBefore !== undefined && stateAfter !== undefined
            ? stateBefore !== stateAfter
            : undefined;
          const okIdx = planProgress.findIndex(
            (p) => p.status === "ok" && p.stepIndex === index && stepKey(p.step) === stepKey(step),
          );
          if (okIdx >= 0) {
            planProgress[okIdx] = {
              ...planProgress[okIdx]!,
              ...(stateBefore !== undefined ? { stateBefore } : {}),
              ...(stateAfter !== undefined ? { stateAfter } : {}),
              ...(stateChanged !== undefined ? { stateChanged } : {}),
            };
          }
          // Estancamiento (spec §4.2c): un paso "snapshot" es intencionalmente
          // pasivo (no muta la página) y no debe contar como estancamiento.
          if (stateChanged === false && step.action !== "snapshot") {
            consecutiveTrivialDiffs += 1;
          } else if (stateChanged === true) {
            consecutiveTrivialDiffs = 0;
          }
          const circuitBreaker = checkCircuitBreaker(lastSnapshot, index);
          if (circuitBreaker.tripped) {
            runOk = false;
            stopReason = "blocked-by-app-error";
            verdict = "fail-app-bug";
            verdictReason = `Error bloqueante de la app tras la acción (paso ${index}): ${circuitBreaker.evidence![0]!.message}`;
            verdictEvidence = circuitBreaker.evidence;
            pendingSteps.length = 0;
            strategistHasMore = false;
            break;
          }
          // Autoridad: evidencia determinista > juez > strategist (spec §3). La
          // victoria verificada se evalúa ANTES que los triggers `error-signal`/
          // `stalled` del juez — un `PageError` warning correlacionado (p. ej. un
          // `role="alert"` de validación) puede ser EXACTAMENTE la condición de
          // victoria configurada (caso `validation-reject-is-app-bug-not-agent-fault`
          // del benchmark); si el motor ya puede resolverlo determinísticamente,
          // el juez ni se invoca.
          const immediateVictory = await checkImmediateVictory(index, horizon, lastSnapshot);
          if (immediateVictory.decision === "success") {
            victoryMet = true;
            stopReason = immediateVictory.reason ?? "victory-met";
            pendingSteps.length = 0;
            strategistHasMore = false;
            break;
          }
          if (immediateVictory.decision === "fail") {
            runOk = false;
            stopReason = immediateVictory.reason ?? "victory-not-met-after-goal-complete";
            if (immediateVictory.verdict) {
              verdict = immediateVictory.verdict;
              verdictReason = `Double-check de persistencia falló tras recargar (paso ${index}): el objetivo "${assist.goal}" implicaba persistir estado y el dato no sobrevivió la recarga.`;
            }
            pendingSteps.length = 0;
            strategistHasMore = false;
            break;
          }
          const unresolvedWarning = detectUnresolvedWarningSignal(lastSnapshot.pageErrors, index, judgedWarningKeys);
          if (unresolvedWarning) {
            for (const e of unresolvedWarning) judgedWarningKeys.add(pageErrorKey(e));
            const outcome = await invokeJudge("error-signal", index, [
              { check: "pageErrors.warning.correlated", passed: false },
            ]);
            if (outcome.verdict === "continue") {
              judgeHint = outcome.hint;
            } else {
              applyTerminalJudgeVerdict(outcome);
              break;
            }
          }
          if (detectStall(consecutiveTrivialDiffs, stalledThreshold)) {
            emit("loop_state", { state: "stalled", stepIndex: index, consecutiveTrivialDiffs }, index);
            const outcome = await invokeJudge("stalled", index, [
              { check: `consecutiveTrivialDiffs < ${stalledThreshold}`, passed: false },
            ]);
            if (outcome.verdict === "continue") {
              judgeHint = outcome.hint;
              consecutiveTrivialDiffs = 0;
            } else {
              applyTerminalJudgeVerdict(outcome);
              break;
            }
          }
        } catch (error) {
          if (aborted || isAbortLikeError(error)) {
            outcomes.push({
              index,
              action: step.action,
              ok: false,
              error: "run cancelado por el usuario",
            });
            runOk = false;
            stopReason = "cancelled";
            break;
          }
          // `error.message` es texto de excepción de Playwright/JS — puede
          // ecoar contenido de página/selector observado por el motor. Se
          // redacta EN LA FUENTE (mismo patrón que `verdictReason`, C3) así
          // los 4 sinks que consumen `message` (este emit, `history.push`,
          // el reintento de heal, y los `outcomes.push` más abajo) heredan
          // el valor ya seguro sin redactar cada uno por separado (GHOST-35).
          const message = redactOrTruncateText(
            stripAnsi(error instanceof Error ? error.message : String(error)),
          );
          emit("step_failure", { step: redactStepForEvent(step), error: message }, index);

          let recovered = false;
          // HEALER-2 / H1: el healer es un actor de percepción, no decide
          // desenlaces. Antes de invocarlo, capturamos el snapshot post-falla
          // UNA sola vez (evita doble drenado de `pageErrorTracker.collectForStep`,
          // ver observer.ts:270-272) y reutilizamos la MISMA correlación por
          // índice que usa el circuit breaker (`detectBlockingAppError`, línea
          // ~1976/2436) para decidir si hay evidencia dura de un bug bloqueante
          // de la app. Si la hay, curar es inútil: cede determinísticamente al
          // juez (`healing-exhausted`) sin gastar intentos de heal ni replan.
          await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
          lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
            pageErrorTracker,
            stepIndex: index,
          });
          const blockingEvidenceBeforeHeal = detectBlockingAppError(lastSnapshot.pageErrors, index);
          let healerAbstainedOnBlocking = false;
          if (blockingEvidenceBeforeHeal) {
            healerAbstainedOnBlocking = true;
            emit(
              "heal_failure",
              {
                reason: "blocking-error-cede-to-judge",
                evidence: redactVerdictEvidence(blockingEvidenceBeforeHeal),
              },
              index,
            );
          }
          for (
            let attempt = 1;
            attempt <= healingAttempts && !recovered && !healerAbstainedOnBlocking;
            attempt++
          ) {
            try {
              healerWasInvoked = true;
              // Intento 1 reutiliza el snapshot pre-loop capturado arriba para
              // no volver a drenar `pageErrorTracker` en el mismo `index`
              // (invariante de un solo `collectForStep` por índice). Los
              // reintentos posteriores sí capturan uno nuevo, como antes.
              if (attempt > 1) {
                await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
                lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
                  pageErrorTracker,
                  stepIndex: index,
                });
              }
              const stateBeforeHeal = snapshotStateKey(lastSnapshot);
              emit(
                "heal_start",
                {
                  attempt,
                  maxAttempts: healingAttempts,
                  nodeCount: lastSnapshot.nodeCount,
                },
                index,
              );
              const recovery = await deps.healer({
                goal: assist.goal,
                baseUrl: input.baseUrl,
                snapshot: lastSnapshot,
                failedStep: step,
                error: message,
                history,
              });
              const sanitized = sanitizeHealerSteps(
                input.baseUrl,
                recovery.steps,
                input.defaultTimeoutMs,
                lastSnapshot.treeMarkdown,
              );
              // `recovery.rationale` es texto libre AUTORADO POR EL HEALER (LLM) —
              // mismo riesgo que el `hint` del juez (puede citar contenido de
              // página/DOM observado). Pasa por el boundary de redacción antes
              // de salir en `heal_failure`/`heal_action` (GHOST-35).
              const safeRationale = recovery.rationale ? redactOrTruncateText(recovery.rationale) : null;
              if (sanitized.length === 0) {
                emit(
                  "heal_failure",
                  { reason: "no-valid-steps", rationale: safeRationale },
                  index,
                );
                break;
              }
              for (const healStep of sanitized) {
                emit(
                  "heal_action",
                  {
                    step: redactStepForEvent(healStep),
                    rationale: safeRationale,
                  },
                  index,
                );
                if (hasSuccessfulHistoryStep(history, healStep)) {
                  planProgress.push({
                    step: healStep,
                    status: "dropped",
                    source: "healer",
                    horizon,
                    stepIndex: index,
                    note: "healer-already-successful",
                  });
                  continue;
                }
                planProgress.push({ step: healStep, status: "pending", source: "healer", horizon });
                await applyStep(page, input.baseUrl, healStep, input.defaultTimeoutMs);
                // W10: paso propuesto por el healer, ejecutado directamente como
                // parte de la recuperación — igual de "healed" que el reintento
                // del paso original más abajo (ambos solo ocurren dentro de un
                // ciclo de heal activo).
                history.push({ step: healStep, ok: true, healed: true });
                const healPendingIdx = findFirstPendingPlanIndex(planProgress, healStep);
                if (healPendingIdx >= 0) {
                  planProgress[healPendingIdx] = {
                    ...planProgress[healPendingIdx]!,
                    status: "ok",
                    stepIndex: index,
                  };
                }
                pushLearnedStep(learnedFlow, healStep);
                if (memoryMode !== "off") {
                  const healKey = stepKey(healStep);
                  if (!runtimeMemoryKeys.has(healKey)) {
                    runtimeMemoryKeys.add(healKey);
                    runtimeMemory.push(healStep);
                  }
                }
              }
              await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
              const postHealSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
                pageErrorTracker,
                stepIndex: index,
              });
              const stateAfterHeal = snapshotStateKey(postHealSnapshot);
              const stateChangedByHeal =
                stateBeforeHeal !== undefined && stateAfterHeal !== undefined
                  ? stateBeforeHeal !== stateAfterHeal
                  : undefined;
              if (stateChangedByHeal === false) {
                consecutiveTrivialDiffs += 1;
              } else if (stateChangedByHeal === true) {
                consecutiveTrivialDiffs = 0;
              }
              const healerReplacedOriginal = hasEquivalentReplacementStep(step, sanitized);
              const skipOriginalStep = healerReplacedOriginal ||
                shouldDropStepInCurrentContext(step, postHealSnapshot, history) ||
                shouldDropRedundantModalOpenClick(step, postHealSnapshot);
              if (!skipOriginalStep) {
                await applyStep(page, input.baseUrl, step, input.defaultTimeoutMs);
                // W10: el paso original se reintenta y tiene éxito TRAS un heal —
                // marcarlo `healed: true` para que el dossier del juez (spec §4.3,
                // `buildJudgeDossier`/`toRecentAction`) pueda distinguirlo de un
                // paso que nunca falló (`ok`) o de uno curado directamente por el
                // healer (línea de arriba, `history.push({ step: healStep, ok: true })`).
                history.push({ step, ok: true, healed: true });
                // Si el healer desbloqueó el paso y luego se reintenta el original,
                // preservar el orden real en finalPlan: healer (index) -> original (index + 0.5).
                const retriedStepIndex = index + 0.5;
                const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
                if (pendingIdx >= 0) {
                  planProgress[pendingIdx] = {
                    ...planProgress[pendingIdx]!,
                    status: "ok",
                    stepIndex: retriedStepIndex,
                    note: "ok-after-heal",
                    ...(stateBeforeHeal !== undefined ? { stateBefore: stateBeforeHeal } : {}),
                    ...(stateAfterHeal !== undefined ? { stateAfter: stateAfterHeal } : {}),
                    ...(stateChangedByHeal !== undefined ? { stateChanged: stateChangedByHeal } : {}),
                  };
                } else {
                  planProgress.push({
                    step,
                    status: "ok",
                    source: "healer",
                    horizon,
                    stepIndex: retriedStepIndex,
                    note: "ok-after-heal",
                    ...(stateBeforeHeal !== undefined ? { stateBefore: stateBeforeHeal } : {}),
                    ...(stateAfterHeal !== undefined ? { stateAfter: stateAfterHeal } : {}),
                    ...(stateChangedByHeal !== undefined ? { stateChanged: stateChangedByHeal } : {}),
                  });
                }
                pushLearnedStep(learnedFlow, step);
                if (memoryMode !== "off") {
                  const key = stepKey(step);
                  if (!runtimeMemoryKeys.has(key)) {
                    runtimeMemoryKeys.add(key);
                    runtimeMemory.push(step);
                  }
                }
              } else {
                const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
                if (pendingIdx >= 0) {
                  planProgress[pendingIdx] = {
                    ...planProgress[pendingIdx]!,
                    status: "dropped",
                    stepIndex: index,
                    note: "replaced-by-healer",
                    ...(stateBeforeHeal !== undefined ? { stateBefore: stateBeforeHeal } : {}),
                    ...(stateAfterHeal !== undefined ? { stateAfter: stateAfterHeal } : {}),
                    ...(stateChangedByHeal !== undefined ? { stateChanged: stateChangedByHeal } : {}),
                  };
                }
                lastSnapshot = postHealSnapshot;
              }
              recovered = true;
              let screenshotPath: string | undefined;
              if (shouldCaptureScreenshots && artifactsDir) {
                screenshotPath = await captureStepScreenshot(page, artifactsDir, index, "ok");
              }
              outcomes.push({
                index,
                action: step.action,
                ok: true,
                ...(screenshotPath ? { screenshotPath } : {}),
              });
              emit(
                "heal_success",
                {
                  step: redactStepForEvent(step),
                  ...(healerReplacedOriginal ? { replacedByHealer: true } : {}),
                  ...(skipOriginalStep ? { skippedOriginal: true } : {}),
                },
                index,
              );
              emit(
                "step_success",
                {
                  step: redactStepForEvent(step),
                  healed: true,
                  ...(healerReplacedOriginal ? { replacedByHealer: true } : {}),
                  ...(skipOriginalStep ? { skippedOriginal: true } : {}),
                  ...(screenshotPath ? { screenshotPath } : {}),
                },
                index,
              );
              lastSnapshot = postHealSnapshot;
              const circuitBreakerAfterHeal = checkCircuitBreaker(lastSnapshot, index);
              if (circuitBreakerAfterHeal.tripped) {
                runOk = false;
                stopReason = "blocked-by-app-error";
                verdict = "fail-app-bug";
                verdictReason = `Error bloqueante de la app tras la acción curada (paso ${index}): ${circuitBreakerAfterHeal.evidence![0]!.message}`;
                verdictEvidence = circuitBreakerAfterHeal.evidence;
                pendingSteps.length = 0;
                strategistHasMore = false;
              } else {
                // Autoridad: evidencia determinista > juez > strategist (spec §3) —
                // misma prioridad que en el camino normal: victoria verificada
                // primero, luego los triggers del juez sobre lo que quede sin resolver.
                const immediateVictoryAfterHeal = await checkImmediateVictory(index, horizon, lastSnapshot);
                if (immediateVictoryAfterHeal.decision === "success") {
                  victoryMet = true;
                  stopReason = immediateVictoryAfterHeal.reason ?? "victory-met";
                  pendingSteps.length = 0;
                  strategistHasMore = false;
                } else if (immediateVictoryAfterHeal.decision === "fail") {
                  runOk = false;
                  stopReason = immediateVictoryAfterHeal.reason ?? "victory-not-met-after-goal-complete";
                  if (immediateVictoryAfterHeal.verdict) {
                    verdict = immediateVictoryAfterHeal.verdict;
                    verdictReason = `Double-check de persistencia falló tras recargar (paso ${index}, post-heal): el objetivo "${assist.goal}" implicaba persistir estado y el dato no sobrevivió la recarga.`;
                  }
                  pendingSteps.length = 0;
                  strategistHasMore = false;
                } else {
                  const unresolvedWarningAfterHeal = detectUnresolvedWarningSignal(
                    lastSnapshot.pageErrors,
                    index,
                    judgedWarningKeys,
                  );
                  if (unresolvedWarningAfterHeal) {
                    for (const e of unresolvedWarningAfterHeal) judgedWarningKeys.add(pageErrorKey(e));
                    const errorSignalOutcome = await invokeJudge("error-signal", index, [
                      { check: "pageErrors.warning.correlated", passed: false },
                    ]);
                    if (errorSignalOutcome.verdict === "continue") {
                      judgeHint = errorSignalOutcome.hint;
                    } else {
                      applyTerminalJudgeVerdict(errorSignalOutcome);
                    }
                  } else if (detectStall(consecutiveTrivialDiffs, stalledThreshold)) {
                    emit("loop_state", { state: "stalled", stepIndex: index, consecutiveTrivialDiffs }, index);
                    const stalledOutcome = await invokeJudge("stalled", index, [
                      { check: `consecutiveTrivialDiffs < ${stalledThreshold}`, passed: false },
                    ]);
                    if (stalledOutcome.verdict === "continue") {
                      judgeHint = stalledOutcome.hint;
                      consecutiveTrivialDiffs = 0;
                    } else {
                      applyTerminalJudgeVerdict(stalledOutcome);
                    }
                  }
                }
              }
              if (victoryMet || !runOk) break;
            } catch (healErr) {
              // Redacción en la fuente, mismo criterio que `message` arriba (GHOST-35).
              const healMessage = redactOrTruncateText(
                stripAnsi(healErr instanceof Error ? healErr.message : String(healErr)),
              );
              emit("heal_failure", { error: healMessage }, index);
            }
          }

          if (!recovered) {
            history.push({ step, ok: false, error: message });
            const pendingIdx = findFirstPendingPlanIndex(planProgress, step);
            if (pendingIdx >= 0) {
              planProgress[pendingIdx] = {
                ...planProgress[pendingIdx]!,
                status: "failed",
                stepIndex: index,
                note: message.slice(0, 160),
              };
            }
            let replannedFromError = false;
            // HEALER-2 / H1: si el healer cedió por evidencia de bug bloqueante,
            // el replan del strategist tampoco tiene sentido (mismo argumento
            // que el heal loop) — el motor no debe intentar "seguir adelante"
            // ante un error determinístico; cede directo al trigger
            // `healing-exhausted` más abajo con el dossier ya cargado.
            try {
              if (!healerAbstainedOnBlocking) {
                await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
                lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
                  pageErrorTracker,
                  stepIndex: index,
                });
                const replanChunk = await deps.strategist({
                  goal: assist.goal,
                  baseUrl: input.baseUrl,
                  snapshot: lastSnapshot,
                  victory: assist.victory,
                  history,
                  planProgress,
                  maxSteps: stepsPerHorizon,
                });
                strategistHasMore = replanChunk.hasMore;
                const replanned: Step[] = [];
                const droppedReplanned: Step[] = [];
                for (const candidate of replanChunk.steps) {
                  if (hasSuccessfulHistoryStep(history, candidate.step)) {
                    droppedReplanned.push(candidate.step);
                    planProgress.push({
                      step: candidate.step,
                      status: "dropped",
                      source: "replan",
                      horizon,
                      stepIndex: index,
                      note: "already-successful",
                    });
                    continue;
                  }
                  if (shouldDropPlannedStep(candidate.step, lastSnapshot, history)) {
                    droppedReplanned.push(candidate.step);
                    planProgress.push({
                      step: candidate.step,
                      status: "dropped",
                      source: "replan",
                      horizon,
                      stepIndex: index,
                      note: "context-drop",
                    });
                    continue;
                  }
                  replanned.push(candidate.step);
                  planProgress.push({
                    step: candidate.step,
                    status: "pending",
                    source: "replan",
                    horizon,
                    stepIndex: index,
                  });
                }
                if (replanned.length > 0) {
                  pendingSteps.unshift(...replanned);
                  replannedFromError = true;
                  emit(
                    "plan_chunk",
                    {
                      horizon,
                      replannedFromError: true,
                      failedStep: redactStepForEvent(step),
                      steps: replanned.map(redactStepForEvent),
                      droppedSteps: droppedReplanned.map(redactStepForEvent),
                      planProgress: planProgress.slice(-120).map((p) => ({
                        status: p.status,
                        source: p.source,
                        step: redactStepForEvent(p.step),
                        ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
                        ...(p.stepIndex !== undefined ? { stepIndex: p.stepIndex } : {}),
                        ...(p.note ? { note: p.note } : {}),
                      })),
                      hasMore: replanChunk.hasMore,
                    },
                  );
                  emit(
                    "step_failure",
                    {
                      step: redactStepForEvent(step),
                      error: message,
                      replannedFromError: true,
                    },
                    index,
                  );
                }
              }
            } catch (replanErr) {
              // Redacción en la fuente, mismo criterio que `message` arriba (GHOST-35).
              const replanMessage = redactOrTruncateText(
                stripAnsi(replanErr instanceof Error ? replanErr.message : String(replanErr)),
              );
              emit("heal_failure", { replanError: replanMessage }, index);
            }

            if (replannedFromError) {
              break;
            }

            let screenshotPath: string | undefined;
            if (artifactsDir) {
              try {
                screenshotPath = await captureStepScreenshot(page, artifactsDir, index, "failed");
              } catch {
                // ignore screenshot failure
              }
            }
            outcomes.push({
              index,
              action: step.action,
              ok: false,
              error: message,
              ...(screenshotPath ? { screenshotPath } : {}),
            });
            emit(
              "step_failure",
              {
                step: redactStepForEvent(step),
                error: message,
                final: true,
                ...(screenshotPath ? { screenshotPath } : {}),
              },
              index,
            );
            // Healer agotó sus intentos (o no había ninguno configurado) Y el
            // replan del strategist tampoco produjo pasos usables: zona gris
            // clásica del trigger `healing-exhausted` (spec §4.3) — ¿el
            // selector estaba mal (test-broken), Ghostly se perdió con un
            // camino que existía (agent-lost), o la app realmente no ofrece
            // ese control (app-bug)? Solo el juez puede distinguirlos con el
            // dossier completo; el motor no adivina.
            const outcome = await invokeJudge("healing-exhausted", index, [
              { check: "healer.recovered", passed: false },
              { check: "strategist.replanProducedSteps", passed: false },
            ]);
            if (outcome.verdict === "continue") {
              judgeHint = outcome.hint;
            } else {
              applyTerminalJudgeVerdict(outcome);
            }
            break;
          }
        }
      }

      if (!runOk || victoryMet) break;
      await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
      lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes, {
        pageErrorTracker,
        stepIndex: nextStepIndex,
      });
      emit("horizon_end", {
        horizon,
        pendingSteps: pendingSteps.length,
        hasMore: strategistHasMore,
      });

      const victory = await evaluateVictory(page, lastSnapshot, assist.victory);
      emit("victory_check", {
        horizon,
        isFullPlan,
        pendingInputSteps: hasPendingInputSteps(planProgress),
        awaitingSeedExpansion: isSeedInputForFullPlan &&
          !healerWasInvoked &&
          !hasGeneratedPlanActivity(planProgress),
        healerWasInvoked,
        victoryConfig: assist.victory ?? null,
        ...victory.details,
        configured: victory.configured,
        met: victory.met,
      });
      if (victory.met) {
        const awaitingSeedExpansion = isSeedInputForFullPlan &&
          !healerWasInvoked &&
          !hasGeneratedPlanActivity(planProgress);
        if (isFullPlan && !healerWasInvoked && (hasPendingInputSteps(planProgress) || awaitingSeedExpansion)) {
          // Seguir con el plan de entrada completo antes de aceptar victory.
        } else {
          const revalidation = await revalidateVictoryIfNeeded(nextStepIndex);
          if (revalidation && !revalidation.survived) {
            runOk = false;
            stopReason = "persistence-check-failed";
            verdict = "fail-app-bug";
            verdictReason = `Double-check de persistencia falló tras recargar (horizonte ${horizon}): el objetivo "${assist.goal}" implicaba persistir estado y el dato no sobrevivió la recarga.`;
            break;
          }
          victoryMet = true;
          stopReason = "victory-met";
          break;
        }
      }
      const awaitingSeedExpansion = isSeedInputForFullPlan &&
        !healerWasInvoked &&
        !hasGeneratedPlanActivity(planProgress);
      if (isFullPlan && pendingSteps.length === 0 && !strategistHasMore && !awaitingSeedExpansion) {
        // Plan agotado sin victoria clara resuelta por el motor: zona gris —
        // el desenlace (¿test mal armado? ¿agente perdido? ¿condición ambigua?)
        // lo decide el juez, nunca una heurística (spec §4.2b/§4.3).
        const reason: JudgeTrigger = "victory-candidate";
        const outcome = await invokeJudge(reason, nextStepIndex - 1, [
          { check: "victory.configured", passed: Boolean(assist.victory) },
          ...(assist.victory ? [{ check: "victory.met", passed: victory.met }] : []),
        ]);
        if (outcome.verdict === "continue") {
          judgeHint = outcome.hint;
        } else {
          applyTerminalJudgeVerdict(outcome);
          break;
        }
      }
      if (!assist.victory && pendingSteps.length === 0 && !strategistHasMore) {
        if (assist.replayFromMemory) {
          // En modo replay dejamos que el loop pida nuevos chunks aunque hasMore=false,
          // para no asumir que la memoria parcial representa el flujo completo.
          continue;
        }
        // Sin condición de victoria configurada, el desenlace SIEMPRE lo decide
        // el juez (spec §4.2b) — nunca se asume éxito por haber consumido pasos.
        const outcome = await invokeJudge("victory-candidate", nextStepIndex - 1, [
          { check: "victory.configured", passed: false },
        ]);
        if (outcome.verdict === "continue") {
          judgeHint = outcome.hint;
        } else {
          applyTerminalJudgeVerdict(outcome);
          break;
        }
      }
      // Si hay victory configurada y ya no quedan pasos, NO fallar todavía:
      // en el siguiente horizonte pedimos otro chunk al strategist.
    }

    if (runOk && assist.victory && !victoryMet) {
      const budgetExhausted = (Date.now() - started) >= maxLoopMs || horizon >= maxHorizons;
      const reason: JudgeTrigger = budgetExhausted ? "budget-exhausted" : "victory-candidate";
      // El `while` ya terminó acá (se agotó el presupuesto o no hubo más horizontes/plan):
      // no hay a dónde "continuar" aunque el juez proponga `continue` — spec §4.2d exige
      // que el desenlace SIEMPRE lo clasifique el juez en este punto, así que igual se
      // invoca, pero un `continue` se degrada a `inconclusive` (no hay presupuesto para
      // actuar sobre un hint que ya no puede ejecutarse).
      const outcome = await invokeJudge(reason, nextStepIndex - 1, [
        { check: "victory.met", passed: false },
        { check: budgetExhausted ? "budget.exhausted" : "budget.remaining", passed: !budgetExhausted },
      ]);
      runOk = false;
      if (outcome.verdict === "continue") {
        verdict = "inconclusive";
        verdictReason =
          "El juez propuso continuar, pero el presupuesto del run (maxLoopMs/maxHorizons) ya se agotó — " +
          `no hay más horizontes disponibles para actuar sobre el hint. Motivo original: ${outcome.reasoning}`;
        stopReason = "judge-terminal-verdict";
      } else {
        applyTerminalJudgeVerdict(outcome);
      }
    }
    emit("loop_state", { state: "stopped", reason: stopReason, horizons: horizon });
  } finally {
    if (context) await context.close();
    if (shouldRecordVideo && pageVideo) {
      try {
        videoPath = await pageVideo.path();
      } catch {
        videoPath = undefined;
      }
    }
    await browser.close().catch(() => undefined);
  }

  for (const p of planProgress) {
    if (p.status !== "pending") continue;
    p.status = "dropped";
    p.note = p.note ?? "not-executed-after-stop";
  }

  const finalPlan = buildFinalGeneralPlan(planProgress, learnedFlow);
  const planProgressReport = toPlanProgressReport(planProgress);
  const planProgressSummary = {
    total: planProgressReport.length,
    ok: planProgressReport.filter((p) => p.status === "ok").length,
    failed: planProgressReport.filter((p) => p.status === "failed").length,
    dropped: planProgressReport.filter((p) => p.status === "dropped").length,
    pending: planProgressReport.filter((p) => p.status === "pending").length,
  };

  // Choke point único (spec §6, fix C3): todo sink que lea `verdictReason`
  // (evento `run_end`, `AssistedRunResult` -> DB `Run.verdictReason` ->
  // `RunRecord` API) recibe el valor ya redactado — nunca el crudo.
  const safeVerdictReason = redactVerdictReason(verdictReason);
  // Choke point único (W15, Kanon GHOST-35): `verdictEvidence` sale del
  // pipeline ya con `.message` redactado, para que cualquier consumidor
  // futuro (dashboard GHOST-32, API response) reciba el valor seguro sin
  // tener que acordarse de redactarlo en el sink de destino.
  const safeVerdictEvidence = redactVerdictEvidence(verdictEvidence);

  emit("run_end", {
    ok: runOk,
    durationMs: Date.now() - started,
    totalSteps: outcomes.length,
    failedSteps: outcomes.filter((o) => !o.ok).length,
    planProgressSummary,
    planProgress: planProgressReport,
    finalPlan: finalPlan.map(redactStepForEvent),
    ...(verdict ? { verdict, verdictReason: safeVerdictReason } : {}),
    ...(judgeEvents.length > 0 ? { judgeInvocations: judgeEvents.length } : {}),
  });

  return {
    ok: runOk,
    durationMs: Date.now() - started,
    steps: outcomes,
    ...(videoPath ? { videoPath } : {}),
    events,
    ...(lastSnapshot ? { lastSnapshot } : {}),
    ...(finalPlan.length > 0 ? { learnedFlow: finalPlan } : {}),
    ...(finalPlan.length > 0 ? { finalPlan } : {}),
    ...(planProgressReport.length > 0 ? { planProgress: planProgressReport } : {}),
    stopReason,
    ...(verdict ? { verdict } : {}),
    ...(safeVerdictReason ? { verdictReason: safeVerdictReason } : {}),
    ...(safeVerdictEvidence ? { verdictEvidence: safeVerdictEvidence } : {}),
    ...(judgeEvents.length > 0 ? { judgeEvents } : {}),
  };
}
