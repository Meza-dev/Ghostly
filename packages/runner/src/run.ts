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
      await page.click(step.selector, { timeout: defaultTimeoutMs });
      return;
    }
    case "fill": {
      await page.fill(step.selector, step.value, { timeout: defaultTimeoutMs });
      return;
    }
    case "press": {
      await page.keyboard.press(step.key);
      return;
    }
    case "waitForSelector": {
      const t = step.timeoutMs ?? defaultTimeoutMs;
      await page.waitForSelector(step.selector, { timeout: t, state: "visible" });
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
