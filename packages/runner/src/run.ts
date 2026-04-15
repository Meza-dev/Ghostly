import { chromium, type Page } from "playwright";
import type { RunInput, Step } from "./schema.js";

export type StepOutcome = {
  index: number;
  action: Step["action"];
  ok: boolean;
  error?: string;
  a11y?: unknown;
};

export type RunResult = {
  ok: boolean;
  durationMs: number;
  steps: StepOutcome[];
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

export async function runFlow(input: RunInput): Promise<RunResult> {
  const started = Date.now();
  const outcomes: StepOutcome[] = [];
  const browser = await chromium.launch({ headless: input.headless });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(input.defaultTimeoutMs);

    for (let index = 0; index < input.steps.length; index++) {
      const step = input.steps[index]!;
      try {
        await applyStep(page, input.baseUrl, step, input.defaultTimeoutMs);
        let a11y: unknown | undefined;
        if (step.action === "snapshot" || input.captureA11yAfterEachStep) {
          a11y = await optionalA11y(page);
        }
        outcomes.push({
          index,
          action: step.action,
          ok: true,
          ...(a11y !== undefined ? { a11y } : {}),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outcomes.push({ index, action: step.action, ok: false, error: message });
        return {
          ok: false,
          durationMs: Date.now() - started,
          steps: outcomes,
        };
      }
    }

    return {
      ok: true,
      durationMs: Date.now() - started,
      steps: outcomes,
    };
  } finally {
    await browser.close();
  }
}
