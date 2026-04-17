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

function expandFillSelectors(primary: string): string[] {
  const s = primary.trim();
  const lower = s.toLowerCase();
  const out: string[] = [s];

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
  if (looksLikeBareKeyword(s)) {
    out.push(
      `input[name="${s}"]`,
      `#${s}`,
      `[id="${s}"]`,
      `[data-testid="${s}"]`,
    );
  }
  return uniqSelectors(out);
}

function expandClickSelectors(primary: string): string[] {
  const s = primary.trim();
  const lower = s.toLowerCase();
  const out: string[] = [s];
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
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const sel = candidates[i]!;
    const timeout = i === 0 ? firstTimeout : retryTimeout;
    try {
      await runOne(page, sel, timeout);
      if (i > 0) {
        // eslint-disable-next-line no-console
        console.log(`[runner] ${label}: selector alternativo OK`, { original: primarySelector, used: sel });
      }
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
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
        (p, sel, t) => p.click(sel, { timeout: t }),
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
        async (p, sel, timeout) => {
          await p.waitForSelector(sel, { timeout, state: "visible" });
        },
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

export async function runFlow(input: RunInput): Promise<RunResult> {
  const started = Date.now();
  const outcomes: StepOutcome[] = [];
  const shouldCaptureScreenshots = input.captureScreenshotAfterEachStep;
  const shouldRecordVideo = input.recordVideoOnFailure;
  const artifactsDir = shouldCaptureScreenshots || shouldRecordVideo
    ? runArtifactDir(input.artifactsDir)
    : undefined;
  const browser = await chromium.launch({ headless: input.headless });

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let pageVideo: Video | null = null;
  let keepVideo = false;
  let runOk = true;
  let videoPath: string | undefined;

  try {
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

    for (let index = 0; index < input.steps.length; index++) {
      const step = input.steps[index]!;
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
      } catch (e) {
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

    await browser.close();
  }

  return {
    ok: runOk,
    durationMs: Date.now() - started,
    steps: outcomes,
    ...(videoPath !== undefined ? { videoPath } : {}),
  };
}
