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

/**
 * Extrae tokens candidatos de ancla desde un selector, en orden de prioridad:
 * data-testid, #id, aria-label, name, texto (:has-text/text=), y como fallback
 * el selector literal completo. Devuelve todos los tokens encontrados (no solo el primero)
 * para permitir un match permisivo (OR) contra el árbol observado.
 */
function extractAnchorTokens(selector: string): string[] {
  const tokens: string[] = [];
  const testIdMatch = /\[data-testid=["']?([^"'\]]+)/i.exec(selector);
  if (testIdMatch?.[1]) tokens.push(testIdMatch[1]);
  const idMatch = /#([A-Za-z0-9_-]+)/.exec(selector);
  if (idMatch?.[1]) tokens.push(idMatch[1]);
  const ariaLabelMatch = /\[aria-label=["']?([^"'\]]+)/i.exec(selector);
  if (ariaLabelMatch?.[1]) tokens.push(ariaLabelMatch[1]);
  const nameMatch = /\[name=["']?([^"'\]]+)/i.exec(selector);
  if (nameMatch?.[1]) tokens.push(nameMatch[1]);
  const textMatch = /:?has-text\(["']([^"']+)["']\)/i.exec(selector) ?? /text=["']?([^"'\]]+)/i.exec(selector);
  if (textMatch?.[1]) tokens.push(textMatch[1]);
  tokens.push(selector.trim());
  return tokens;
}

/** Verifica que al menos un token de ancla del selector aparezca (case-insensitive) en el árbol observado. */
function anchorExistsInMap(selector: string, treeMarkdown: string): boolean {
  const haystack = treeMarkdown.toLowerCase();
  return extractAnchorTokens(selector).some((token) => haystack.includes(token.toLowerCase()));
}

/** Sanitiza los steps propuestos por el healer: mismo origin, acciones válidas, selectores no ambiguos y máximo 3 pasos. */
export function sanitizeHealerSteps(
  baseUrl: string,
  proposed: Step[],
  maxTimeoutMs: number,
  observedTreeMarkdown?: string,
): Step[] {
  const gateActive =
    typeof observedTreeMarkdown === "string" && observedTreeMarkdown.trim().length > 0;
  // D7: gate por presencia de `selector` (no por lista de acciones) — cubre uniformemente
  // los 8 verbos con selector; goto/press/snapshot no tienen `selector` y pasan de largo.
  const capped = proposed.slice(0, 3).filter((s) => {
    if ("selector" in s) {
      if (isAmbiguous(s.selector)) return false;
      if (/\[\s*ref\s*=\s*e\d+/i.test(s.selector)) return false;
      if (gateActive && !anchorExistsInMap(s.selector, observedTreeMarkdown)) return false;
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
