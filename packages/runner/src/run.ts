import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Video } from "playwright";
import type { RunInput, Step } from "./schema.js";

export type StepOutcome = {
  index: number;
  action: Step["action"];
  ok: boolean;
  error?: string;
  a11y?: unknown;
  screenshotPath?: string;
};

export type RunResult = {
  ok: boolean;
  durationMs: number;
  steps: StepOutcome[];
  videoPath?: string;
};

type RunFlowOptions = {
  signal?: AbortSignal;
  onStepStart?: (ctx: { index: number; step: Step }) => void | Promise<void>;
  onStepSuccess?: (ctx: { index: number; step: Step; screenshotPath?: string; a11y?: unknown }) => void | Promise<void>;
  onStepFailure?: (ctx: { index: number; step: Step; error: string; screenshotPath?: string; final: boolean }) => void | Promise<void>;
};

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const msg = error instanceof Error ? error.message : String(error);
  return /abort|cancel/i.test(msg);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("run cancelado por el usuario");
  }
}

function resolveUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const path = url.startsWith("/") ? url : `/${url}`;
  return new URL(path, baseUrl).href;
}

/** Evita duplicados conservando el orden (el primario va primero). */
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

/** Palabra suelta tipo «username» sin sintaxis CSS (error típico de LLM). */
function looksLikeBareKeyword(selector: string): boolean {
  const t = selector.trim();
  if (!t) return false;
  if (/[#\[\].:\s=]/.test(t)) return false;
  return /^[a-z0-9_-]+$/i.test(t);
}

function stripLeadingDecorativeGlyphs(text: string): string {
  return text.replace(/^[^\p{L}\p{N}"']+/u, "").replace(/\s+/g, " ").trim();
}

function escapeCssAttr(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandFillSelectors(primary: string): string[] {
  const s = primary.trim();
  const lower = s.toLowerCase();
  const out: string[] = [s];

  /** Buscadores y cajas de consulta: muchas UIs usan textarea o cambian name/aria-label. */
  const isLikelySearchQueryField =
    /name\s*=\s*['"]q['"]|\[name\s*=\s*['"]q['"]\]|searchbox|omnibox|buscador/i.test(s) ||
    (/(input|textarea)/i.test(s) && /\bq\b/.test(lower));

  if (isLikelySearchQueryField) {
    out.push(
      "textarea[name='q']",
      'textarea[name="q"]',
      'textarea[aria-label*="Search"]',
      'textarea[aria-label*="Buscar"]',
      "input[name='q']",
      'input[name="q"]',
      'input[aria-label*="Search"]',
      'input[aria-label*="Buscar"]',
      'input[title*="Buscar"]',
      "[role='search'] textarea",
      "[role='search'] input",
      'form[role="search"] textarea',
      'form[role="search"] input',
    );
  }

  if (lower.includes("username") || /name\s*=\s*['"]?\s*username/i.test(s)) {
    out.push(
      'input[name="email"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[type="email"]',
      "#email",
      'input[id="email"]',
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
    out.push('input[type="password"]', 'input[name="password"]');
  }

  return uniqSelectors(out);
}

function expandWaitSelectors(primary: string): string[] {
  const s = primary.trim();
  const out: string[] = [s];
  const lower = s.toLowerCase();
  if (looksLikeBareKeyword(s)) {
    out.push(
      `input[name="${s}"]`,
      `#${s}`,
      `[id="${s}"]`,
      `[data-testid="${s}"]`,
    );
  }
  // "nav" suele fallar en apps que renderizan navegación como <aside> o role="navigation".
  if (lower === "nav" || lower === "navigation") {
    out.push(
      "[role='navigation']",
      '[role="navigation"]',
      "aside",
      "header nav",
      "aside nav",
      "[data-testid*='nav']",
      "[data-testid*='menu']",
      "[aria-label*='menu']",
      "[aria-label*='naveg']",
    );
  }
  return uniqSelectors([...out, ...expandClickSelectors(s)]);
}

/** Ver packages/runner/src/assist/pipeline.ts (misma semántica). */
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
    if (c) out.push(`__gt:role=link;name=${encodeURIComponent(c)}`);
  }
  if (out.length === 0) {
    const textOnly = s0.match(/^text=(.+)/i)?.[1];
    if (textOnly) {
      const c = stripLeadingDecorativeGlyphs(textOnly.replace(/^['"]|['"]$/g, ""));
      if (c) out.push(`__gt:role=button;name=${encodeURIComponent(c)}`);
    }
  }
  return out;
}

function expandClickSelectors(primary: string): string[] {
  const s0 = primary.trim().replace(/^link(?=\s*:)/i, "a");
  const lower = s0.toLowerCase();
  const out: string[] = [...gtRoleFirstCandidates(s0), s0];
  const isGenericFormSubmit =
    /^form\s+button$/i.test(s0) ||
    /^form\s+input$/i.test(s0) ||
    /^form\s+input\[type\s*=\s*['"]?submit['"]?\]$/i.test(s0);
  if (isGenericFormSubmit) {
    out.push(
      'form button[type="submit"]',
      'form input[type="submit"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'form button:has-text("Ingresar")',
      'form button:has-text("Entrar")',
      'form button:has-text("Iniciar sesión")',
      'form button:has-text("Login")',
      'button:has-text("Ingresar")',
      'button:has-text("Entrar")',
      'button:has-text("Iniciar sesión")',
      'button:has-text("Login")',
    );
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
    out.push('button[type="submit"]', 'input[type="submit"]', 'button:has-text("Entrar")', 'button:has-text("Ingresar")');
  }
  return uniqSelectors(out);
}

async function waitForTargetVisible(page: Page, selector: string, timeout: number): Promise<void> {
  const s = selector.trim();
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
      await page
        .getByRole("button", { name: new RegExp(escapeRegex(name), "i") })
        .first()
        .waitFor({ state: "visible", timeout });
      return;
    }
    await page.getByRole("link", { name: new RegExp(escapeRegex(name), "i") }).first().waitFor({ state: "visible", timeout });
    return;
  }
  const buttonText = s.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (buttonText) {
    const clean = stripLeadingDecorativeGlyphs(buttonText);
    if (clean) {
      try {
        await page
          .getByRole("button", { name: new RegExp(escapeRegex(clean), "i") })
          .first()
          .waitFor({ state: "visible", timeout });
        return;
      } catch {
        /* continuar */
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
  const s = selector.trim();
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
      await page.getByRole("button", { name: new RegExp(escapeRegex(name), "i") }).first().click({ timeout });
      return;
    }
    await page.getByRole("link", { name: new RegExp(escapeRegex(name), "i") }).first().click({ timeout });
    return;
  }
  const buttonText = s.match(/^button:has-text\((['"])([\s\S]*?)\1\)/i)?.[2];
  if (buttonText) {
    const clean = stripLeadingDecorativeGlyphs(buttonText);
    if (clean) {
      try {
        await page.getByRole("button", { name: new RegExp(escapeRegex(clean), "i") }).first().click({ timeout });
        return;
      } catch {
        /* continuar */
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
        /* continuar */
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
        /* continuar */
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
        /* continuar */
      }
    }
  }
  await page.click(s, { timeout });
}

function stripAnsi(message: string): string {
  return message.replace(/\u001b\[[0-9;]*m/g, "");
}

function selectorAttemptLabel(sel: string): string {
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
  const candidates = expand(primarySelector);
  const firstTimeout = defaultTimeoutMs;
  const retryTimeout = Math.min(12_000, Math.max(3_000, Math.floor(defaultTimeoutMs / 3)));
  const attemptErrors: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const sel = candidates[i]!;
    const timeout = i === 0 ? firstTimeout : retryTimeout;
    try {
      await runOne(page, sel, timeout);
      if (i > 0) {
        // eslint-disable-next-line no-console
        console.log(`[runner] ${label}: selector alternativo OK`, {
          original: primarySelector,
          used: selectorAttemptLabel(sel),
        });
      }
      return;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      attemptErrors.push(`• ${selectorAttemptLabel(sel)} → ${stripAnsi(raw).slice(0, 280)}`);
    }
  }
  const summary =
    `Tras probar ${candidates.length} selector(es) para «${label}» (plan: ${primarySelector.slice(0, 120)}${primarySelector.length > 120 ? "…" : ""}), ninguno respondió a tiempo o no existe en la página. ` +
    `Revisa cookies/bloqueos de la UI o ajusta el selector.\nIntentos:\n${attemptErrors.join("\n")}`;
  throw new Error(summary);
}

async function applyStep(
  page: Page,
  baseUrl: string,
  step: Step,
  defaultTimeoutMs: number,
): Promise<void> {
  switch (step.action) {
    case "goto": {
      const target = resolveUrl(baseUrl, step.url);
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: defaultTimeoutMs,
      });
      return;
    }
    case "click": {
      await tryWithSelectorFallbacks(
        page,
        "click",
        step.selector,
        defaultTimeoutMs,
        expandClickSelectors,
        (p, sel, t) => clickWithSmartSelector(p, sel, t),
      );
      return;
    }
    case "fill": {
      await tryWithSelectorFallbacks(
        page,
        "fill",
        step.selector,
        defaultTimeoutMs,
        expandFillSelectors,
        (p, sel, t) => p.fill(sel, step.value, { timeout: t }),
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

async function optionalA11y(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot({ mode: "ai", timeout: 15_000 });
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

export async function runFlow(input: RunInput, opts: RunFlowOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const outcomes: StepOutcome[] = [];
  const shouldCaptureScreenshots = input.captureScreenshotAfterEachStep;
  const shouldRecordVideo = input.recordVideoOnFailure;
  const artifactsDir = shouldCaptureScreenshots || shouldRecordVideo
    ? runArtifactDir(input.artifactsDir)
    : undefined;
  const browser = await chromium.launch({ headless: input.headless });
  const signal = opts.signal;

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let pageVideo: Video | null = null;
  let keepVideo = false;
  let runOk = true;
  let videoPath: string | undefined;
  let aborted = false;

  try {
    throwIfAborted(signal);
    if (artifactsDir) {
      await mkdir(artifactsDir, { recursive: true });
    }

    context = await browser.newContext(
      shouldRecordVideo && artifactsDir
        ? {
            recordVideo: {
              dir: artifactsDir,
            },
          }
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
    signal?.addEventListener("abort", onAbort, { once: true });

    for (let index = 0; index < input.steps.length; index++) {
      throwIfAborted(signal);
      const step = input.steps[index]!;
      await opts.onStepStart?.({ index, step });
      // Logging básico de cada paso para depuración interactiva
      // eslint-disable-next-line no-console
      console.log(
        `[runner] Ejecutando paso ${index + 1}/${input.steps.length}`,
        JSON.stringify(step),
      );
      try {
        await applyStep(page, input.baseUrl, step, input.defaultTimeoutMs);
        let a11y: unknown | undefined;
        if (step.action === "snapshot" || input.captureA11yAfterEachStep) {
          a11y = await optionalA11y(page);
        }
        let screenshotPath: string | undefined;
        if (shouldCaptureScreenshots && artifactsDir) {
          screenshotPath = await captureStepScreenshot(page, artifactsDir, index, "ok");
        }
        outcomes.push({
          index,
          action: step.action,
          ok: true,
          ...(a11y !== undefined ? { a11y } : {}),
          ...(screenshotPath !== undefined ? { screenshotPath } : {}),
        });
        await opts.onStepSuccess?.({
          index,
          step,
          ...(a11y !== undefined ? { a11y } : {}),
          ...(screenshotPath !== undefined ? { screenshotPath } : {}),
        });
      } catch (e) {
        if (aborted || isAbortLikeError(e)) {
          await opts.onStepFailure?.({
            index,
            step,
            error: "run cancelado por el usuario",
            final: true,
          });
          outcomes.push({
            index,
            action: step.action,
            ok: false,
            error: "run cancelado por el usuario",
          });
          runOk = false;
          break;
        }
        const message = e instanceof Error ? e.message : String(e);
        // eslint-disable-next-line no-console
        console.error(
          `[runner] Error en paso ${index + 1}/${input.steps.length}`,
          message,
        );
        let screenshotPath: string | undefined;
        if (artifactsDir) {
          try {
            screenshotPath = await captureStepScreenshot(page, artifactsDir, index, "failed");
          } catch {
            // Ignore screenshot errors; preserve the original step failure.
          }
        }
        outcomes.push({
          index,
          action: step.action,
          ok: false,
          error: message,
          ...(screenshotPath !== undefined ? { screenshotPath } : {}),
        });
        await opts.onStepFailure?.({
          index,
          step,
          error: message,
          ...(screenshotPath !== undefined ? { screenshotPath } : {}),
          final: true,
        });
        keepVideo = true;
        runOk = false;
        break;
      }
    }
  } finally {
    if (context) {
      await context.close();
    }

    if (shouldRecordVideo && pageVideo) {
      try {
        const savedVideoPath = await pageVideo.path();
        if (!keepVideo) {
          await unlink(savedVideoPath).catch(() => undefined);
        } else {
          videoPath = savedVideoPath;
        }
      } catch {
        videoPath = undefined;
      }
    }

    await browser.close().catch(() => undefined);
  }

  return {
    ok: runOk,
    durationMs: Date.now() - started,
    steps: outcomes,
    ...(videoPath !== undefined ? { videoPath } : {}),
  };
}
