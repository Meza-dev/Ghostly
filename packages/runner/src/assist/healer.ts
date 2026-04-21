import { safeParseRunInput } from "../schema.js";
import type { Step } from "../schema.js";
import type { HealerContext, HealerFn, HealerResult } from "./types.js";

export type { HealerContext, HealerFn, HealerResult };

const AMBIGUOUS_HEALER_SELECTORS = new Set([
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "button[type=submit]",
  'button[type="submit"]',
  "button[type='submit']",
  "input[type=text]",
  'input[type="text"]',
  "input[type='text']",
  "input[type=password]",
  'input[type="password"]',
  "input[type='password']",
  "input[type=email]",
  'input[type="email"]',
  "input[type='email']",
  "[type=submit]",
  "form button",
  "form input",
]);

function isAmbiguous(selector: string): boolean {
  const norm = selector.trim().toLowerCase().replace(/\s+/g, " ");
  return AMBIGUOUS_HEALER_SELECTORS.has(norm);
}

/** Sanitiza los steps propuestos por el healer: mismo origin, acciones válidas, selectores no ambiguos y máximo 3 pasos. */
export function sanitizeHealerSteps(
  baseUrl: string,
  proposed: Step[],
  maxTimeoutMs: number,
): Step[] {
  const capped = proposed.slice(0, 3).filter((s) => {
    if (s.action === "click" || s.action === "fill" || s.action === "waitForSelector") {
      if (isAmbiguous(s.selector)) return false;
      if (/\[\s*ref\s*=\s*e\d+/i.test(s.selector)) return false;
    }
    return true;
  });
  const parsed = safeParseRunInput(
    {
      baseUrl,
      steps: capped.length > 0 ? capped : [{ action: "snapshot" as const }],
      defaultTimeoutMs: Math.min(maxTimeoutMs, 30_000),
    },
    { enforceSameOrigin: true, maxSteps: 3, maxTimeoutMs },
  );
  if (!parsed.success) return [];
  return parsed.data.steps;
}
