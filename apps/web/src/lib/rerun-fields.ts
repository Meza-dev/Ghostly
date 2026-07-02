import type { Step } from "../../../../packages/runner/src/schema.js";

/** Campo `fill` editable derivado de un run ya ejecutado, listo para el modal "Cambiar datos". */
export type EditableFillField = {
  /** Posición del step dentro de `rerunnableSteps` — clave determinista para overridear. */
  replayIndex: number;
  /** Etiqueta legible derivada del selector. */
  label: string;
  sensitive: boolean;
  /** Solo presente cuando el campo NO es sensible (nunca se expone un valor previo sensible). */
  currentValue?: string;
};

/** Misma regla que usa el runner (pipeline.ts) para decidir si un selector es sensible. */
const SENSITIVE_SELECTOR_RE = /pass|password|secret|token|api[_-]?key/i;

const ARIA_LABEL_RE = /\[aria-label=["']([^"']+)["']\]/i;
const PLACEHOLDER_RE = /\[placeholder=["']([^"']+)["']\]/i;
const NAME_RE = /\[name=["']([^"']+)["']\]/i;
const ID_RE = /#([A-Za-z0-9_-]+)/;
const TYPE_RE = /input\[type=["']?([a-z]+)["']?\]|\[type=["']?([a-z]+)["']?\]/i;

const TYPE_LABELS: Record<string, string> = {
  email: "Email",
  tel: "Teléfono",
  password: "Contraseña",
  text: "Texto",
  number: "Número",
  search: "Búsqueda",
  url: "URL",
  date: "Fecha",
};

const MAX_LABEL_LENGTH = 40;

function humanize(raw: string): string {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return raw;
  return spaced
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function truncateSelector(selector: string, max = MAX_LABEL_LENGTH): string {
  return selector.length > max ? `${selector.slice(0, max - 1)}…` : selector;
}

/**
 * Deriva una etiqueta legible parseando el selector CSS del step (no hay atributos
 * aria/placeholder estructurados en los eventos persistidos — ver ADR-2 del diseño).
 * Prioridad: aria-label > placeholder > name > #id > input[type] > selector crudo truncado.
 */
function deriveFieldLabel(selector: string): string {
  const ariaMatch = ARIA_LABEL_RE.exec(selector);
  if (ariaMatch?.[1]) return ariaMatch[1];

  const placeholderMatch = PLACEHOLDER_RE.exec(selector);
  if (placeholderMatch?.[1]) return placeholderMatch[1];

  const nameMatch = NAME_RE.exec(selector);
  if (nameMatch?.[1]) return humanize(nameMatch[1]);

  const idMatch = ID_RE.exec(selector);
  if (idMatch?.[1]) return humanize(idMatch[1]);

  const typeMatch = TYPE_RE.exec(selector);
  const type = (typeMatch?.[1] ?? typeMatch?.[2])?.toLowerCase();
  if (type && TYPE_LABELS[type]) return TYPE_LABELS[type];

  return truncateSelector(selector);
}

/**
 * Un step `fill` es sensible cuando su valor ya fue redactado por el runner
 * (`redactStepForEvent`, señal autoritativa) o cuando su selector matchea la
 * misma heurística que usa el runner para detectar passwords/secrets/tokens.
 */
function isSensitiveFillStep(step: Extract<Step, { action: "fill" }>): boolean {
  return step.value === "[REDACTED]" || SENSITIVE_SELECTOR_RE.test(step.selector);
}

/** Extrae los campos `fill` editables de los steps reconstruidos de un run ya ejecutado. */
export function deriveEditableFillFields(rerunnableSteps: Step[]): EditableFillField[] {
  const fields: EditableFillField[] = [];
  rerunnableSteps.forEach((step, index) => {
    if (step.action !== "fill") return;
    const sensitive = isSensitiveFillStep(step);
    fields.push({
      replayIndex: index,
      label: deriveFieldLabel(step.selector),
      sensitive,
      ...(sensitive ? {} : { currentValue: step.value }),
    });
  });
  return fields;
}

function getInitialGotoFromBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const path = parsed.pathname && parsed.pathname !== "" ? parsed.pathname : "/";
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Reconstruye la secuencia de steps para el replay literal ("Cambiar datos"),
 * reemplazando solo el `value` de los `fill` overrideados. Garantiza que la
 * secuencia sea autocontenida anteponiendo un `goto` inicial si falta.
 */
export function buildOverriddenSteps(
  rerunnableSteps: Step[],
  overrides: Record<number, string>,
  baseUrl: string,
): Step[] {
  const overridden = rerunnableSteps.map((step, index) => {
    if (step.action !== "fill") return step;
    const overrideValue = overrides[index];
    if (overrideValue === undefined) return step;
    return { ...step, value: overrideValue };
  });

  if (overridden.length > 0 && overridden[0]?.action === "goto") {
    return overridden;
  }

  const firstGoto: Step = { action: "goto", url: getInitialGotoFromBaseUrl(baseUrl) };
  return [firstGoto, ...overridden];
}

/** Appendea una instrucción adicional al goal existente ("Añadir instrucciones"). */
export function appendInstructionsToGoal(baseGoal: string, extra: string): string {
  const trimmed = extra.trim();
  return trimmed ? `${baseGoal}\n\nInstrucción adicional: ${trimmed}` : baseGoal;
}
