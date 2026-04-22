import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Video } from "playwright";
import type { Locator } from "playwright";
import type { StepOutcome, RunResult } from "../run.js";
import type { Step } from "../schema.js";
import { captureObserverSnapshot } from "./observer.js";
import { sanitizeHealerSteps } from "./healer.js";
import type {
  AssistEvent,
  AssistEventType,
  AssistedRunInput,
  HealerFn,
  ObserverSnapshot,
  PlanProgressItem,
  PlanProgressReportItem,
  StrategistFn,
} from "./types.js";

export type AssistedRunResult = RunResult & {
  events: AssistEvent[];
  lastSnapshot?: ObserverSnapshot;
  learnedFlow?: Step[];
  finalPlan?: Step[];
  planProgress?: PlanProgressReportItem[];
};

export type AssistedDeps = {
  strategist: StrategistFn;
  healer: HealerFn;
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
 * Etiquetas típicas del sidebar/backoffice: `text=Viajes` no debe resolverse contra el h1
 * «Gestión de Viajes» (substring). Priorizar enlace en `nav` / role=link.
 */
function looksLikeSidebarNavLabel(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2 || t.length > 48) return false;
  return /^(home|conductores|usuarios|locaciones|veh[ií]culos|viajes|importador|clientes|documentos(\s+log[ií]sticos)?|cerrar\s+sesi[oó]n)$/i.test(
    t,
  );
}

async function clickOrWaitNavLinkByLabel(
  page: Page,
  label: string,
  timeout: number,
  mode: "click" | "visible",
): Promise<void> {
  const re = new RegExp(`^\\s*${escapeRegex(label.trim())}\\s*$`, "i");
  const navLink = page.locator(`nav a, [role="navigation"] a`).filter({ hasText: re }).first();
  if (mode === "visible") {
    await navLink.waitFor({ state: "visible", timeout });
    return;
  }
  await navLink.click({ timeout });
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

/** Aviso de Google Maps en localhost sin API key suele tapar clics; cerrar OK si está visible. */
async function dismissGoogleMapsLoadErrorIfPresent(page: Page): Promise<void> {
  try {
    const banner = page
      .getByText(
        /can't load Google Maps|no puede cargar|load Google Maps correctly|cargar Google Maps correctamente/i,
      )
      .first();
    const visible = await banner.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) return;
    const ok = page.getByRole("button", { name: /^OK$/i }).first();
    if (await ok.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await ok.click({ timeout: 8_000 });
      await page.waitForTimeout(250);
    }
  } catch {
    /* no bloquear el flujo */
  }
}

async function prepareTransientOverlaysForAutomation(page: Page): Promise<void> {
  await dismissGoogleMapsLoadErrorIfPresent(page);
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

/** Clics tipo «Crear calificación» que abren un panel cuyo HTML puede vivir fuera del slice del hash del body. */
function clickSelectorLikelyOpensCreationSurface(selector: string): boolean {
  const s = selector.toLowerCase();
  const createIntent = /crear|nueva|nuevo|add\s+new|\bnew\s+/i.test(s);
  const domain = /calific|grupo|rating|evalu|registro|item|viaje|trabajo|usuario/i.test(s);
  return createIntent && domain;
}

/**
 * Señales de que el clic abrió un formulario de creación aunque `hashDomSlice` no cambie
 * (p. ej. portales/modales con poco impacto en los primeros 16k del innerHTML del body).
 */
async function creationSurfaceVisibleAfterClick(page: Page): Promise<boolean> {
  const probes: Array<Promise<boolean>> = [
    page
      .getByRole("heading", { name: /crear\s+(grupo|calificaci[oó]n)/i })
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false),
    page
      .getByText(/calificaciones\s+del\s+grupo/i)
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false),
    page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: /crear\s+grupo/i }) })
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false),
  ];
  const results = await Promise.all(probes);
  return results.some(Boolean);
}

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

function naturalLanguageVictorySatisfied(
  snapshot: ObserverSnapshot,
  raw: string,
  history: Array<{ step: Step; ok: boolean; error?: string }>,
): boolean {
  const phrase = normalizeLooseText(raw);
  if (!phrase) return false;
  const hay = normalizeLooseText(`${snapshot.title}\n${snapshot.url}\n${snapshot.treeMarkdown}`);
  if (!hay) return false;
  if (hay.includes(phrase)) return true;

  const looksNatural =
    /[\s,;]/.test(phrase) || phrase.length > 40 || (!/[#.\[\]=:]/.test(phrase) && !/^text=/.test(phrase));
  if (!looksNatural) return false;

  const asksToast = /\b(toast|alerta|notific|mensaje)\b/.test(phrase);
  const asksCreate = /\b(creacion|crear|creada|creado|guardad|confirm|exito)\b/.test(phrase);
  const asksTable = /\b(tabla|listado|table|row|fila)\b/.test(phrase);
  const asksCalif = /\bcalific/.test(phrase);
  const asksNueva = /\bnueva\b/.test(phrase);

  const hasListadoCalif = /listado de calificaciones/.test(hay);
  const hasNuevaCalifRow = /row\s+"[^"\n]*nueva calific/.test(hay) || /cell\s+"nueva calific/.test(hay);

  // Frases tipo "toast de creación y aparece en tabla nueva calificación":
  // si la tabla ya refleja la nueva fila, consideramos victoria aunque el toast sea efímero.
  const hasFinalize = hasAnyFinalizeAction(history);
  // Evita falso positivo temprano: para "aparece en tabla / toast creación"
  // exigimos que ya exista acción final de guardado/confirmación.
  if ((asksToast || asksCreate) && asksTable && asksCalif && hasNuevaCalifRow) return hasFinalize;
  if (asksNueva && asksCalif && hasListadoCalif && hasNuevaCalifRow) return hasFinalize;
  if (asksTable && asksCalif && hasNuevaCalifRow) return hasFinalize;

  return false;
}

function selectorLikelyNeedsFinalizeAction(raw: string): boolean {
  const phrase = normalizeLooseText(raw);
  if (!phrase) return false;
  const asksToast = /\b(toast|alerta|notific|mensaje)\b/.test(phrase);
  const asksCreate = /\b(creacion|crear|creada|creado|guardad|confirm|exito)\b/.test(phrase);
  const asksTable = /\b(tabla|listado|table|row|fila)\b/.test(phrase);
  const asksCalif = /\bcalific/.test(phrase);
  return asksCalif && (asksTable || asksToast || asksCreate);
}

function goalMentionsCalificacionesCreate(goal: string): boolean {
  const g = normalizeLooseText(goal);
  return /calific/.test(g) && /(crear|crea|nueva|nuevo)/.test(g);
}

function makeUniqueCalificacionName(value: string, uniqueTag: string): string {
  const base = value.trim().replace(/\s+/g, " ");
  if (!base) return value;
  const alreadyUnique = /gt-[a-z0-9]{4,}/i.test(base);
  if (alreadyUnique) return value;
  return `${base} GT-${uniqueTag}`;
}

function maybeUniquifyFillStep(step: Step, goal: string, uniqueTag: string): Step {
  if (step.action !== "fill") return step;
  if (!goalMentionsCalificacionesCreate(goal)) return step;
  if (isAuthLikeFillStep(step)) return step;
  const sel = step.selector.toLowerCase();
  const val = normalizeLooseText(step.value);
  const looksNameField =
    sel.includes("de malo a excelente") ||
    sel.includes("nombre del grupo") ||
    sel.includes("calificaci");
  const genericNameValue =
    val === "nueva calificacion" ||
    val === "nueva calificación" ||
    val === "calificacion" ||
    val === "calificación";
  if (!looksNameField && !genericNameValue) return step;
  const uniqueValue = makeUniqueCalificacionName(step.value, uniqueTag);
  if (uniqueValue === step.value) return step;
  return { ...step, value: uniqueValue };
}

function isAuthLikeFillStep(step: Step): boolean {
  if (step.action !== "fill") return false;
  const s = step.selector.toLowerCase();
  return /user|usuario|email|login|pass|password|contrase|token|api[_-]?key|secret/i.test(s);
}

function collectRecentBusinessFillValues(history: Array<{ step: Step; ok: boolean; error?: string }>): string[] {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (!h.ok || h.step.action !== "fill" || isAuthLikeFillStep(h.step)) continue;
    const v = h.step.value.trim();
    if (v.length <= 1) continue;
    if (/^\d+$/.test(v)) continue;
    if (/^(ok|si|sí|no|n\/a)$/i.test(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

function snapshotContainsAnyValue(snapshot: ObserverSnapshot, values: string[]): boolean {
  if (values.length === 0) return false;
  const hay = normalizeLooseText(`${snapshot.title}\n${snapshot.url}\n${snapshot.treeMarkdown}`);
  if (!hay) return false;
  return values.some((v) => {
    const n = normalizeLooseText(v);
    return n.length >= 3 && hay.includes(n);
  });
}

function isBusinessFillStep(step: Step): boolean {
  return step.action === "fill" && !isAuthLikeFillStep(step);
}

function isBusinessFinalizeStep(step: Step): boolean {
  if (step.action === "press") return /enter/i.test(step.key);
  if (step.action !== "click") return false;
  const s = step.selector.toLowerCase();
  if (/ingresar|entrar|sign in|login/.test(s)) return false;
  if (isLoginLikeStep(step)) return false;
  return /guardar|save|confirm|confirmar|continuar|finalizar|crear calificaci[oó]n/i.test(s);
}

function hasAnyFinalizeAction(history: Array<{ step: Step; ok: boolean; error?: string }>): boolean {
  let lastBusinessFill = -1;
  for (let i = 0; i < history.length; i++) {
    const h = history[i]!;
    if (!h.ok) continue;
    if (isBusinessFillStep(h.step)) lastBusinessFill = i;
    if (isBusinessFinalizeStep(h.step) && lastBusinessFill >= 0 && i > lastBusinessFill) {
      return true;
    }
  }
  return false;
}

function objectiveLikelyCompleted(
  history: Array<{ step: Step; ok: boolean; error?: string }>,
  snapshot: ObserverSnapshot,
): boolean {
  const fillValues = collectRecentBusinessFillValues(history);
  if (fillValues.length === 0) return false;
  if (!hasAnyFinalizeAction(history)) return false;
  return snapshotContainsAnyValue(snapshot, fillValues);
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

  // En el modal de calificaciones, el LLM a veces propone "Ej: Excelente" o aria-label
  // "Calificación" para el campo de etiqueta. Forzamos candidatos robustos del campo real.
  const looksLikeCalificacionLabelField =
    lower.includes("ej: excelente") ||
    lower.includes("aria-label=\"calificación\"") ||
    lower.includes("aria-label='calificación'") ||
    lower.includes("aria-label=\"calificacion\"") ||
    lower.includes("aria-label='calificacion'") ||
    /calificaci[oó]n/.test(lower);
  if (looksLikeCalificacionLabelField) {
    out.push(
      '[placeholder="Etiqueta (Ej: Malo, Regular, Bueno)"]',
      '[placeholder*="Etiqueta"]',
      'input[placeholder*="Etiqueta"]',
      'textarea[placeholder*="Etiqueta"]',
      "__gt:fill:placeholder=Etiqueta%20(Ej%3A%20Malo%2C%20Regular%2C%20Bueno)",
      "__gt:fill:placeholderPrefix=Etiqueta",
      "__gt:fill:textboxName=Etiqueta",
    );
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
        if (looksLikeSidebarNavLabel(t)) {
          out.push(`__gt:role=link;name=${encodeURIComponent(t)}`);
          const q = t.includes("'") ? '"' : "'";
          const inner = q === "'" ? t.replace(/'/g, "\\'") : t.replace(/"/g, '\\"');
          out.push(`a:has-text(${q}${inner}${q})`);
        }
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
    if (looksLikeSidebarNavLabel(name)) {
      try {
        await page
          .getByRole("link", { name: new RegExp(`^\\s*${escapeRegex(name.trim())}\\s*$`, "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
      }
      await clickOrWaitNavLinkByLabel(page, name, timeout, "visible");
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
      const t = clean.trim();
      if (looksLikeSidebarNavLabel(t)) {
        try {
          await page
            .getByRole("link", { name: new RegExp(`^\\s*${escapeRegex(t)}\\s*$`, "i") })
            .first()
            .waitFor({ state: "visible", timeout });
          return;
        } catch {
          /* continuar */
        }
        try {
          await clickOrWaitNavLinkByLabel(page, t, timeout, "visible");
          return;
        } catch {
          /* continuar */
        }
      }
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
    if (looksLikeSidebarNavLabel(name)) {
      try {
        await page
          .getByRole("link", { name: new RegExp(`^\\s*${escapeRegex(name.trim())}\\s*$`, "i") })
          .first()
          .click({ timeout });
        return;
      } catch {
        /* continuar */
      }
      try {
        await clickOrWaitNavLinkByLabel(page, name, timeout, "click");
        return;
      } catch {
        /* continuar */
      }
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
      const t = clean.trim();
      if (looksLikeSidebarNavLabel(t)) {
        try {
          await page
            .getByRole("link", { name: new RegExp(`^\\s*${escapeRegex(t)}\\s*$`, "i") })
            .first()
            .click({ timeout });
          return;
        } catch {
          /* continuar */
        }
        try {
          await clickOrWaitNavLinkByLabel(page, t, timeout, "click");
          return;
        } catch {
          /* continuar */
        }
      }
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
      await prepareTransientOverlaysForAutomation(page);
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
        const creationOpened =
          clickSelectorLikelyOpensCreationSurface(step.selector) &&
          (dialogsAfter > dialogsBefore || (await creationSurfaceVisibleAfterClick(page)));
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
      await prepareTransientOverlaysForAutomation(page);
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
      await prepareTransientOverlaysForAutomation(page);
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
 * (p. ej. wait click "Crear Viaje" + título "Crear Nuevo Viaje").
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

/** Heurística TMS: modal «Crear Nuevo Viaje» ya abierto (título + formulario / remitos en el mapa). */
function treeIndicatesCreateTripModalOpen(snapshot: ObserverSnapshot | undefined): boolean {
  if (!snapshot) return false;
  const t = `${snapshot.treeMarkdown}\n${snapshot.title ?? ""}`.toLowerCase();
  if (!t.includes("crear nuevo viaje")) return false;
  return (
    t.includes("conductorid") ||
    t.includes("vehiculoid") ||
    t.includes("remito") ||
    t.includes("react-select")
  );
}

function treeIndicatesCalificacionGroupModalOpen(snapshot: ObserverSnapshot | undefined): boolean {
  if (!snapshot) return false;
  const t = `${snapshot.treeMarkdown}\n${snapshot.title ?? ""}`.toLowerCase();
  const hasHeading =
    t.includes("crear grupo") ||
    t.includes("crear grupos") ||
    t.includes("editar grupo") ||
    t.includes("editar grupos");
  if (!hasHeading) return false;
  return (
    t.includes("calificaciones del grupo") ||
    t.includes("textbox \"ej: de malo a excelente\"") ||
    t.includes("textbox \"etiqueta (ej: malo, regular, bueno)\"") ||
    (t.includes("guardar") && t.includes("cancelar"))
  );
}

function selectorTargetsAgregarDatos(selector: string): boolean {
  const s = selector.toLowerCase();
  return s.includes("agregar datos") || /aria-label\s*=\s*["']?agregar datos["']?/i.test(selector);
}

function selectorTargetsIllusoryCreateTripButton(step: Step, selector: string): boolean {
  const raw = selector.trim();
  const s = raw.toLowerCase();
  if (!s.includes("crear nuevo viaje")) return false;
  if (/^h[1-6]:(has-text|text)\(/i.test(raw)) return false;
  if (s.startsWith("heading:has-text")) return false;
  if (step.action === "click" && (s.includes("button") || s.includes("role=button"))) return true;
  if (step.action === "waitForSelector" && s.includes("button")) return true;
  return false;
}

/**
 * Evita reabrir el flujo cuando el mapa ya muestra el formulario del modal (p. ej. botón «Agregar Datos»
 * detrás del modal hace timeout al click; «Crear Nuevo Viaje» en pantalla es un h3, no un button).
 */
function shouldDropStaleOpenActionWhenModalFormVisible(step: Step, snapshot: ObserverSnapshot | undefined): boolean {
  if (!treeIndicatesCreateTripModalOpen(snapshot)) return false;
  if (step.action !== "click" && step.action !== "waitForSelector") return false;
  const sel = step.selector;
  if (selectorTargetsAgregarDatos(sel)) return true;
  if (selectorTargetsIllusoryCreateTripButton(step, sel)) return true;
  return false;
}

/** Ya en solicitar-viajes con modal de creación: ir de nuevo a «Viajes» es redundante y suele chocar con el h1. */
function shouldDropRedundantViajesNavWhenOnTripsFlow(step: Step, snapshot: ObserverSnapshot | undefined): boolean {
  if (!snapshot?.url) return false;
  const u = snapshot.url.toLowerCase();
  if (!u.includes("solicitar-viajes")) return false;
  if (!treeIndicatesCreateTripModalOpen(snapshot)) return false;
  if (step.action !== "click" && step.action !== "waitForSelector") return false;
  const low = step.selector.toLowerCase();
  if (!low.includes("viajes")) return false;
  if (low.includes("gestión") || low.includes("gestion")) return false;
  return (
    low.startsWith("text=") ||
    low.includes("a:has-text") ||
    low.includes("__gt:role=link") ||
    low.includes("__gt:role=button")
  );
}

/** Con modal de calificaciones abierto, re-navegar sidebar o reabrir modal es redundante y rompe el flujo. */
function shouldDropRedundantCalificacionesFlowNav(step: Step, snapshot: ObserverSnapshot | undefined): boolean {
  if (!treeIndicatesCalificacionGroupModalOpen(snapshot)) return false;
  if (step.action !== "click" && step.action !== "waitForSelector") return false;
  const low = step.selector.toLowerCase();
  const targetsSidebar =
    /has-text\(\s*["']diseño["']\s*\)/i.test(low) ||
    /has-text\(\s*["']calificaciones["']\s*\)/i.test(low) ||
    /text\s*=\s*["']?diseño["']?$/i.test(low) ||
    /text\s*=\s*["']?calificaciones["']?$/i.test(low);
  const targetsReopenCreate =
    /has-text\(\s*["']crear calificaci[oó]n["']\s*\)/i.test(low) ||
    /text\s*=\s*["']?crear calificaci[oó]n["']?$/i.test(low);
  return targetsSidebar || targetsReopenCreate;
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
    shouldDropRedundantModalOpenClick(step, snapshot) ||
    shouldDropStaleOpenActionWhenModalFormVisible(step, snapshot) ||
    shouldDropRedundantViajesNavWhenOnTripsFlow(step, snapshot) ||
    shouldDropRedundantCalificacionesFlowNav(step, snapshot)
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

function hasTerminalLock(history: Array<{ step: Step; ok: boolean; error?: string }>): boolean {
  let lastTerminalOk = -1;
  for (let i = 0; i < history.length; i++) {
    const h = history[i]!;
    if (h.ok && isLikelyTerminalAction(h.step)) {
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

async function evaluateVictory(
  page: Page,
  snapshot: ObserverSnapshot,
  victory: NonNullable<AssistedRunInput["assist"]>["victory"] | undefined,
  history: Array<{ step: Step; ok: boolean; error?: string }>,
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
    const finalized = hasAnyFinalizeAction(history);
    for (const selector of victory.selectorVisible) {
      const visible = await victoryTargetVisible(page, selector);
      const sem = naturalLanguageVictorySatisfied(snapshot, selector, history);
      const candidate = visible || sem;
      if (candidate && selectorLikelyNeedsFinalizeAction(selector) && !finalized) {
        selectorResults.push(false);
        continue;
      }
      selectorResults.push(candidate);
    }
    details.selectorVisible = selectorResults;
    checks.push(victory.mustAll ? selectorResults.every(Boolean) : selectorResults.some(Boolean));
  }

  const met = checks.length === 0 ? false : (victory.mustAll ? checks.every(Boolean) : checks.some(Boolean));
  return { configured: true, met, details };
}

export async function runAssistedFlow(
  input: AssistedRunInput,
  deps: AssistedDeps,
  opts: AssistedRunOptions = {},
): Promise<AssistedRunResult> {
  const started = Date.now();
  const events: AssistEvent[] = [];
  const outcomes: StepOutcome[] = [];
  const history: Array<{ step: Step; ok: boolean; error?: string }> = [];
  const runUniqueTag = Date.now().toString(36).slice(-6);

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
    lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
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
    let stopReason = "completed";
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

    const checkImmediateVictory = async (
      stepIndex: number,
      horizonNo: number,
      snapshotOverride?: ObserverSnapshot,
      executedStep?: Step,
    ): Promise<{ decision: "continue" | "success" | "fail"; reason?: string }> => {
      if (snapshotOverride) {
        lastSnapshot = snapshotOverride;
      } else {
        await waitForKnownModalLoadersToFinish(page!, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
        lastSnapshot = await captureObserverSnapshot(page!, observerMaxNodes);
      }
      const victory = assist.victory
        ? await evaluateVictory(page!, lastSnapshot, assist.victory, history)
        : { configured: false, met: false, details: { reason: "not-configured" } };
      const objectiveComplete = objectiveLikelyCompleted(history, lastSnapshot);
      const terminalStep = executedStep ? isLikelyTerminalAction(executedStep) : false;
      emit(
        "victory_check",
        {
          horizon: horizonNo,
          immediate: true,
          ...victory.details,
          configured: victory.configured,
          met: victory.met,
          objectiveLikelyCompleted: objectiveComplete,
          terminalStep,
        },
        stepIndex,
      );
      if (victory.met) return { decision: "success", reason: "victory-met" };
      if (objectiveComplete) {
        if (!assist.victory && terminalStep) {
          return { decision: "success", reason: "objective-likely-complete" };
        }
        if (assist.victory) {
          return { decision: "fail", reason: "victory-not-met-after-goal-complete" };
        }
      }
      return { decision: "continue" };
    };

    while (runOk && (Date.now() - started) < maxLoopMs && horizon < maxHorizons) {
      throwIfAborted(opts.signal);
      horizon += 1;
      emit("horizon_start", { horizon, pendingSteps: pendingSteps.length });

      if (pendingSteps.length === 0) {
        emit("loop_state", { state: "planning", horizon });
        await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
        lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
        const chunk = await deps.strategist({
          goal: assist.goal,
          baseUrl: input.baseUrl,
          snapshot: lastSnapshot,
          victory: assist.victory,
          history,
          planProgress,
          maxSteps: stepsPerHorizon,
        });
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
            stopReason = "no-steps-generated";
            if (assist.victory) runOk = false;
            break;
          }
        }
      }

      emit("loop_state", { state: "executing", horizon });
      const horizonSteps = pendingSteps.splice(0, stepsPerHorizon);
      for (const step of horizonSteps) {
        throwIfAborted(opts.signal);
        const index = nextStepIndex++;
        if (step.action === "fill") {
          const uniq = maybeUniquifyFillStep(step, assist.goal, runUniqueTag);
          if (uniq.action === "fill" && uniq.value !== step.value) {
            step.value = uniq.value;
          }
        }
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
        if (isLikelyTerminalAction(step) && hasTerminalLock(history)) {
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
          lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
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
          const immediateVictory = await checkImmediateVictory(index, horizon, lastSnapshot, step);
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
            pendingSteps.length = 0;
            strategistHasMore = false;
            break;
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
          const message = stripAnsi(error instanceof Error ? error.message : String(error));
          emit("step_failure", { step: redactStepForEvent(step), error: message }, index);

          let recovered = false;
          for (let attempt = 1; attempt <= healingAttempts && !recovered; attempt++) {
            try {
              await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
              lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
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
              );
              if (sanitized.length === 0) {
                emit(
                  "heal_failure",
                  { reason: "no-valid-steps", rationale: recovery.rationale ?? null },
                  index,
                );
                break;
              }
              for (const healStep of sanitized) {
                emit(
                  "heal_action",
                  {
                    step: redactStepForEvent(healStep),
                    rationale: recovery.rationale ?? null,
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
                history.push({ step: healStep, ok: true });
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
              const postHealSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
              const stateAfterHeal = snapshotStateKey(postHealSnapshot);
              const stateChangedByHeal =
                stateBeforeHeal !== undefined && stateAfterHeal !== undefined
                  ? stateBeforeHeal !== stateAfterHeal
                  : undefined;
              const healerReplacedOriginal = hasEquivalentReplacementStep(step, sanitized);
              const skipOriginalStep = healerReplacedOriginal ||
                shouldDropStepInCurrentContext(step, postHealSnapshot, history) ||
                shouldDropRedundantModalOpenClick(step, postHealSnapshot) ||
                shouldDropStaleOpenActionWhenModalFormVisible(step, postHealSnapshot) ||
                shouldDropRedundantViajesNavWhenOnTripsFlow(step, postHealSnapshot) ||
                shouldDropRedundantCalificacionesFlowNav(step, postHealSnapshot);
              if (!skipOriginalStep) {
                await applyStep(page, input.baseUrl, step, input.defaultTimeoutMs);
                history.push({ step, ok: true });
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
              const immediateVictoryAfterHeal = await checkImmediateVictory(
                index,
                horizon,
                lastSnapshot,
                step,
              );
              if (immediateVictoryAfterHeal.decision === "success") {
                victoryMet = true;
                stopReason = immediateVictoryAfterHeal.reason ?? "victory-met";
                pendingSteps.length = 0;
                strategistHasMore = false;
              } else if (immediateVictoryAfterHeal.decision === "fail") {
                runOk = false;
                stopReason = immediateVictoryAfterHeal.reason ?? "victory-not-met-after-goal-complete";
                pendingSteps.length = 0;
                strategistHasMore = false;
              }
              if (victoryMet || !runOk) break;
            } catch (healErr) {
              const healMessage = stripAnsi(
                healErr instanceof Error ? healErr.message : String(healErr),
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
            try {
              await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
              lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
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
            } catch (replanErr) {
              const replanMessage = stripAnsi(
                replanErr instanceof Error ? replanErr.message : String(replanErr),
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
            runOk = false;
            stopReason = "step-failed";
            break;
          }
        }
      }

      if (!runOk || victoryMet) break;
      await waitForKnownModalLoadersToFinish(page, modalLoaderBudgetMs(assist, started, maxLoopMs), log);
      lastSnapshot = await captureObserverSnapshot(page, observerMaxNodes);
      emit("horizon_end", {
        horizon,
        pendingSteps: pendingSteps.length,
        hasMore: strategistHasMore,
      });

      const victory = await evaluateVictory(page, lastSnapshot, assist.victory, history);
      const completed = assist.victory ? objectiveLikelyCompleted(history, lastSnapshot) : false;
      emit("victory_check", {
        horizon,
        ...victory.details,
        configured: victory.configured,
        met: victory.met,
        objectiveLikelyCompleted: completed,
      });
      if (victory.met) {
        victoryMet = true;
        stopReason = "victory-met";
        break;
      }
      if (assist.victory && completed) {
        runOk = false;
        stopReason = "victory-not-met-after-goal-complete";
        break;
      }
      if (!assist.victory && pendingSteps.length === 0 && !strategistHasMore) {
        if (assist.replayFromMemory) {
          // En modo replay dejamos que el loop pida nuevos chunks aunque hasMore=false,
          // para no asumir que la memoria parcial representa el flujo completo.
          continue;
        }
        stopReason = "steps-completed";
        break;
      }
      // Si hay victory configurada y ya no quedan pasos, NO fallar todavía:
      // en el siguiente horizonte pedimos otro chunk al strategist.
    }

    if (runOk && assist.victory && !victoryMet) {
      runOk = false;
      if ((Date.now() - started) >= maxLoopMs) stopReason = "max-loop-ms";
      else if (horizon >= maxHorizons) stopReason = "max-horizons";
      else if (stopReason === "completed") stopReason = "victory-not-met";
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

  emit("run_end", {
    ok: runOk,
    durationMs: Date.now() - started,
    totalSteps: outcomes.length,
    failedSteps: outcomes.filter((o) => !o.ok).length,
    planProgressSummary,
    planProgress: planProgressReport,
    finalPlan: finalPlan.map(redactStepForEvent),
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
  };
}
