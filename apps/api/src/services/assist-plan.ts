import {
  safeParseRunInput,
  type AssistedMeta,
  type RunInput,
} from "@ghostly-io/runner";
import { z } from "zod";
import { completeJson, getLlmDisplayModel, isLlmConfigured } from "../llm/client.js";
import { LlmError } from "../llm/errors.js";
import { msg, type Lang } from "../i18n/pick.js";

export class AssistPlanError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function logAssist(message: string, details?: Record<string, unknown>): void {
  if (details) {
    // eslint-disable-next-line no-console
    console.log(`[assist-plan] ${message}`, details);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[assist-plan] ${message}`);
}

export type AssistPlanRequest = {
  goal: string;
  baseUrl: string;
  maxSteps: number;
  maxTimeoutMs: number;
  timeoutMs: number;
  lang?: Lang;
};

export type AssistPlanResult = {
  draft: RunInput;
  meta: AssistedMeta;
};

const SYSTEM_PROMPT = [
  "Eres un planificador de pruebas E2E para Playwright. Razona según el CONTEXTO DE URL y el objetivo del usuario.",
  "Responde SIEMPRE y SOLO con un objeto JSON válido (sin markdown, sin texto extra) con esta forma EXACTA:",
  '{ "baseUrl": string, "steps": Step[], "defaultTimeoutMs"?: number }',
  "donde Step es una de estas variantes (campos exactos, sin extras):",
  '- { "action": "goto", "url": string }',
  '- { "action": "click", "selector": string }',
  '- { "action": "fill", "selector": string, "value": string }',
  '- { "action": "press", "key": string }',
  '- { "action": "waitForSelector", "selector": string, "timeoutMs"?: number }',
  '- { "action": "snapshot" }',
  "Reglas generales:",
  '- "steps" SIEMPRE es un array (mínimo 1). NUNCA devuelvas un único step suelto.',
  '- Las acciones permitidas son SOLO las de la lista anterior. Nada de "type", "navigate", "wait".',
  "- Los selectores deben ser CSS válido (ej: input[name='email'], button[type='submit']).",
  "- Para login, prefiere selectores robustos por name/type/role.",
  "- Usa rutas relativas en goto.url cuando compartan baseUrl (ej: /login).",
  "Buscadores (Google, Bing, etc.) y objetivos de «buscar»:",
  "- Tras goto a la home, el cuadro de búsqueda puede ser input O textarea (p.ej. Google a menudo usa textarea[name='q']).",
  "- Si el usuario quiere buscar una consulta, el fill debe usar un selector coherente con ese sitio; para google.com prueba textarea[name='q'] o input[name='q'].",
  "- Si el sitio muestra banner de cookies o consentimiento, puedes añadir pasos cortos waitForSelector + click en botones típicos (Aceptar/Acepto/Accept/Essential only) SOLO si el selector es probable en CSS (button:has-text(...)) válido en Playwright.",
  "- No inventes pasos que no puedan expresarse con las acciones permitidas.",
  "Ejemplo válido:",
  '{"baseUrl":"https://app.example.com","steps":[{"action":"goto","url":"/login"},{"action":"fill","selector":"input[name=\'email\']","value":"user@test.com"},{"action":"fill","selector":"input[name=\'password\']","value":"secret"},{"action":"click","selector":"button[type=\'submit\']"},{"action":"waitForSelector","selector":"text=Bienvenido"}]}',
].join("\n");

function describeBaseUrlContext(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    const origin = u.origin;
    const host = u.hostname;
    const path = u.pathname || "/";
    const hints: string[] = [];
    if (/google\./i.test(host)) {
      hints.push(
        "Dominio Google: la búsqueda principal suele estar en textarea[name='q'] o input[name='q']; puede aparecer consentimiento de cookies antes de interactuar.",
      );
    } else if (/bing\.com/i.test(host)) {
      hints.push("Bing: el campo de búsqueda suele ser input[name='q'] o #sb_form_q.");
    } else if (/duckduckgo\./i.test(host)) {
      hints.push("DuckDuckGo: suele ser input[name='q'] o #searchbox_input.");
    }
    return [
      `URL declarada (origin): ${origin}`,
      `Host: ${host}`,
      `Ruta inicial útil para goto relativo: ${path}`,
      hints.length > 0 ? `Notas: ${hints.join(" ")}` : "Notas: adapta selectores a esta URL real.",
    ].join("\n");
  } catch {
    return `URL base (texto): ${baseUrl}`;
  }
}

function buildUserPrompt(baseUrl: string, goal: string, retryHint?: string): string {
  const context = [
    describeBaseUrlContext(baseUrl),
    "",
    "Objetivo del usuario (interpreta la intención, no solo palabras sueltas):",
    goal.trim(),
  ].join("\n");
  if (!retryHint) return context;
  return `${context}\n\nLa respuesta anterior NO cumplió el contrato. Errores: ${retryHint}\nDevuelve ahora el JSON con la forma EXACTA {"baseUrl":..., "steps":[...]}.`;
}

function normalizeAction(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  if (v === "navigate") return "goto";
  if (v === "wait") return "waitForSelector";
  if (v === "type") return "fill";
  if (v === "keypress") return "press";
  if (v === "a11y" || v === "ariaSnapshot") return "snapshot";
  if (v === "select" || v === "choose") return "selectOption";
  return value.trim();
}

export function coerceStep(step: unknown): Record<string, unknown> | null {
  if (!step || typeof step !== "object") return null;
  const raw = step as Record<string, unknown>;
  const action = normalizeAction(raw.action ?? raw.type ?? raw.name);
  if (!action) return null;

  if (action === "goto") {
    const url = raw.url ?? raw.path ?? raw.target;
    if (typeof url !== "string" || !url.trim()) return null;
    return { action: "goto", url: url.trim() };
  }
  if (action === "click") {
    const selector = raw.selector ?? raw.target ?? raw.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    return { action: "click", selector: selector.trim() };
  }
  if (action === "fill") {
    const selector = raw.selector ?? raw.target ?? raw.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    const value = raw.value ?? raw.text ?? "";
    return {
      action: "fill",
      selector: selector.trim(),
      value: typeof value === "string" ? value : String(value),
    };
  }
  if (action === "press") {
    const key = raw.key ?? raw.value ?? "Enter";
    return { action: "press", key: typeof key === "string" ? key : String(key) };
  }
  if (action === "waitForSelector") {
    const selector = raw.selector ?? raw.target ?? raw.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    const timeoutMs = raw.timeoutMs ?? raw.timeout;
    if (typeof timeoutMs === "number") {
      return { action: "waitForSelector", selector: selector.trim(), timeoutMs };
    }
    return { action: "waitForSelector", selector: selector.trim() };
  }
  if (action === "snapshot") {
    return { action: "snapshot" };
  }
  if (action === "selectOption") {
    // Gate T0/T1 (expand-runner-action-vocabulary, obs #429): este coerceStep
    // es el propio del path de plan de una sola pasada (/v1/plan), separado
    // del `coerceStep` del orchestrator (assist-orchestrator.ts) usado en el
    // loop live strategist/healer — sin este caso el verbo se descartaba en
    // silencio también acá. Mismo contrato: value string|string[] (D1).
    const selector = raw.selector ?? raw.target ?? raw.locator;
    if (typeof selector !== "string" || !selector.trim()) return null;
    const rawValue = raw.value ?? raw.values;
    if (Array.isArray(rawValue)) {
      const values = rawValue.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (values.length === 0) return null;
      return { action: "selectOption", selector: selector.trim(), value: values };
    }
    if (typeof rawValue !== "string" || !rawValue.trim()) return null;
    return { action: "selectOption", selector: selector.trim(), value: rawValue };
  }
  return null;
}

function looksLikeBareStep(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const action = obj.action ?? obj.type ?? obj.name;
  return typeof action === "string" && action.trim().length > 0;
}

function normalizePlanCandidate(raw: unknown, baseUrl: string): unknown {
  if (Array.isArray(raw)) {
    return { baseUrl, steps: raw.map(coerceStep).filter(Boolean) };
  }
  if (!raw || typeof raw !== "object") return raw;

  // El modelo a veces devuelve un único step suelto: lo envolvemos en {baseUrl, steps:[step]}
  if (looksLikeBareStep(raw)) {
    const single = coerceStep(raw);
    return { baseUrl, steps: single ? [single] : [] };
  }

  const obj = raw as Record<string, unknown>;
  const nested = [
    obj.runInput,
    obj.plan,
    obj.draft,
    obj.result,
    obj.output,
  ].find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
  const candidate = nested ?? obj;

  // Aceptar también "step" / "action" en singular por si el modelo confunde la forma
  const rawSteps =
    (Array.isArray(candidate.steps) ? candidate.steps : undefined) ??
    (Array.isArray(candidate.actions) ? candidate.actions : undefined) ??
    (Array.isArray(candidate.plan) ? candidate.plan : undefined) ??
    (looksLikeBareStep(candidate.step) ? [candidate.step] : undefined) ??
    (looksLikeBareStep(candidate.action) ? [candidate.action] : undefined);

  if (!("baseUrl" in candidate) || typeof candidate.baseUrl !== "string") {
    candidate.baseUrl = baseUrl;
  }
  if (rawSteps) {
    candidate.steps = rawSteps.map(coerceStep).filter(Boolean);
  }
  return candidate;
}

function buildFallbackSteps(goal: string): RunInput["steps"] {
  const normalized = goal.toLowerCase();
  if (normalized.includes("login") || normalized.includes("iniciar ses")) {
    return [
      { action: "goto", url: "/login" },
      { action: "waitForSelector", selector: "form" },
      { action: "snapshot" },
    ];
  }
  if (normalized.includes("crear usuario") || normalized.includes("registro")) {
    return [
      { action: "goto", url: "/signup" },
      { action: "waitForSelector", selector: "form" },
      { action: "snapshot" },
    ];
  }
  return [
    { action: "goto", url: "/" },
    { action: "snapshot" },
  ];
}

async function callAssistLlm(
  goal: string,
  baseUrl: string,
  timeoutMs: number,
  lang: Lang,
  retryHint?: string,
): Promise<unknown> {
  const configured = await isLlmConfigured();
  if (!configured) {
    logAssist("Usando fallback local (sin proveedor LLM configurado)", {
      baseUrl,
      goalLength: goal.length,
    });
    return {
      baseUrl,
      steps: buildFallbackSteps(goal),
      defaultTimeoutMs: 30_000,
    };
  }

  logAssist("Llamando proveedor LLM para generar plan", {
    model: getLlmDisplayModel(),
    baseUrl,
    goalLength: goal.length,
    timeoutMs,
    retry: Boolean(retryHint),
  });

  try {
    const parsed = await completeJson(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(baseUrl, goal, retryHint) },
      ],
      { timeoutMs, label: "assist-plan", model: getLlmDisplayModel() },
    );
    if (Object.keys(parsed).length === 0) {
      throw new AssistPlanError(msg("assist.emptyLlmResponse", lang), 502);
    }
    const validated = z.unknown().parse(parsed);
    // eslint-disable-next-line no-console
    console.log("[assist-plan] IA — JSON parseado", JSON.stringify(validated, null, 2));
    const normalized = normalizePlanCandidate(validated, baseUrl);
    logAssist("Respuesta LLM parseada correctamente");
    return normalized as RunInput;
  } catch (error) {
    if (error instanceof AssistPlanError) throw error;
    if (error instanceof LlmError && error.status === 504) {
      throw new AssistPlanError(msg("assist.planTimeout", lang), 504);
    }
    if (error instanceof LlmError) {
      throw new AssistPlanError(msg("assist.planGenerationFailed", lang), 502);
    }
    throw new AssistPlanError(msg("assist.planProcessingError", lang), 502);
  }
}

export async function generateAssistPlan(input: AssistPlanRequest): Promise<AssistPlanResult> {
  const model = getLlmDisplayModel();
  const lang: Lang = input.lang ?? "en";
  logAssist("Inicio de generación de plan asistido", {
    baseUrl: input.baseUrl,
    maxSteps: input.maxSteps,
    maxTimeoutMs: input.maxTimeoutMs,
    timeoutMs: input.timeoutMs,
  });
  const guardrails = {
    maxSteps: input.maxSteps,
    maxTimeoutMs: input.maxTimeoutMs,
    enforceSameOrigin: true,
  };
  let candidate = await callAssistLlm(input.goal, input.baseUrl, input.timeoutMs, lang);
  let parsed = safeParseRunInput(candidate, guardrails);

  // Reintento: si los steps no validan, pedimos al modelo que corrija con el detalle del error
  if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "steps")) {
    const issueSummary = parsed.error.issues
      .filter((issue) => issue.path[0] === "steps")
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join(" | ");
    logAssist("Plan inválido, reintentando con feedback al modelo", { issueSummary });
    try {
      candidate = await callAssistLlm(input.goal, input.baseUrl, input.timeoutMs, lang, issueSummary);
      parsed = safeParseRunInput(candidate, guardrails);
    } catch (error) {
      logAssist("Reintento al modelo falló", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback local: si tras el reintento sigue sin haber steps válidos
  if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "steps")) {
    logAssist("Plan sin pasos válidos tras reintento, usando fallback local", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
    parsed = safeParseRunInput(
      {
        baseUrl: input.baseUrl,
        steps: buildFallbackSteps(input.goal),
        defaultTimeoutMs: 30_000,
      },
      guardrails,
    );
  }
  if (!parsed.success) {
    logAssist("Plan rechazado por guardrails", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    throw new AssistPlanError(msg("assist.invalidPlan", lang), 400);
  }

  logAssist("Plan asistido validado", {
    steps: parsed.data.steps.length,
    model,
  });

  return {
    draft: parsed.data,
    meta: {
      goal: input.goal,
      model,
      generatedAt: new Date().toISOString(),
      promptVersion: "assist-v2",
    },
  };
}
