import {
  safeParseRunInput,
  type AssistedMeta,
  type RunInput,
} from "@ghosttester/runner";
import { z } from "zod";

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
};

export type AssistPlanResult = {
  draft: RunInput;
  meta: AssistedMeta;
};

function llmConfig() {
  return {
    endpoint: process.env.ASSIST_LLM_API_URL?.trim() || "",
    apiKey: process.env.ASSIST_LLM_API_KEY?.trim() || "",
    model: process.env.ASSIST_LLM_MODEL?.trim() || "assist-fallback-v1",
  };
}

const SYSTEM_PROMPT = [
  "Eres un planificador de pruebas E2E para Playwright.",
  "Responde SIEMPRE y SOLO con un objeto JSON válido (sin markdown, sin texto extra) con esta forma EXACTA:",
  '{ "baseUrl": string, "steps": Step[], "defaultTimeoutMs"?: number }',
  "donde Step es una de estas variantes (campos exactos, sin extras):",
  '- { "action": "goto", "url": string }',
  '- { "action": "click", "selector": string }',
  '- { "action": "fill", "selector": string, "value": string }',
  '- { "action": "press", "key": string }',
  '- { "action": "waitForSelector", "selector": string, "timeoutMs"?: number }',
  '- { "action": "snapshot" }',
  "Reglas:",
  '- "steps" SIEMPRE es un array (mínimo 1). NUNCA devuelvas un único step suelto.',
  '- Las acciones permitidas son SOLO las de la lista anterior. Nada de "type", "navigate", "wait".',
  "- Los selectores deben ser CSS válido (ej: input[name='email'], button[type='submit']).",
  "- Para login, prefiere selectores robustos por name/type/role.",
  "- Usa rutas relativas en goto.url cuando compartan baseUrl (ej: /login).",
  "Ejemplo válido:",
  '{"baseUrl":"https://app.example.com","steps":[{"action":"goto","url":"/login"},{"action":"fill","selector":"input[name=\'email\']","value":"user@test.com"},{"action":"fill","selector":"input[name=\'password\']","value":"secret"},{"action":"click","selector":"button[type=\'submit\']"},{"action":"waitForSelector","selector":"text=Bienvenido"}]}',
].join("\n");

function buildUserPrompt(baseUrl: string, goal: string, retryHint?: string): string {
  const base = `Base URL: ${baseUrl}\nObjetivo: ${goal}`;
  if (!retryHint) return base;
  return `${base}\n\nLa respuesta anterior NO cumplió el contrato. Errores: ${retryHint}\nDevuelve ahora el JSON con la forma EXACTA {"baseUrl":..., "steps":[...]}.`;
}

function extractJsonBlock(raw: string): string {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  return raw;
}

function normalizeAction(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  if (v === "navigate") return "goto";
  if (v === "wait") return "waitForSelector";
  if (v === "type") return "fill";
  if (v === "keypress") return "press";
  if (v === "a11y" || v === "ariaSnapshot") return "snapshot";
  return value.trim();
}

function coerceStep(step: unknown): Record<string, unknown> | null {
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
  retryHint?: string,
): Promise<unknown> {
  const config = llmConfig();
  if (!config.endpoint || !config.apiKey) {
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
    endpoint: config.endpoint,
    model: config.model,
    baseUrl,
    goalLength: goal.length,
    timeoutMs,
    retry: Boolean(retryHint),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildUserPrompt(baseUrl, goal, retryHint),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AssistPlanError("No se pudo generar plan asistido", 502);
    }
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown;
        };
      }>;
    };
    // Respuesta completa del proveedor (útil para depurar formato / errores del modelo)
    // eslint-disable-next-line no-console
    console.log("[assist-plan] IA — cuerpo HTTP del proveedor", JSON.stringify(payload, null, 2));
    const content = payload.choices?.[0]?.message?.content;
    const rawContent = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text?: unknown }).text ?? "")
                : "",
            )
            .join("")
        : "";
    if (!rawContent) {
      throw new AssistPlanError("Respuesta LLM vacía", 502);
    }
    // Texto que devolvió el modelo (antes de extraer fence ```json)
    // eslint-disable-next-line no-console
    console.log("[assist-plan] IA — contenido assistant (raw)", rawContent);
    const parsed = z.unknown().parse(JSON.parse(extractJsonBlock(rawContent)));
    // eslint-disable-next-line no-console
    console.log("[assist-plan] IA — JSON parseado", JSON.stringify(parsed, null, 2));
    const normalized = normalizePlanCandidate(parsed, baseUrl);
    logAssist("Respuesta LLM parseada correctamente");
    return normalized as RunInput;
  } catch (error) {
    if (error instanceof AssistPlanError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AssistPlanError("Timeout al generar plan asistido", 504);
    }
    throw new AssistPlanError("Error al procesar respuesta del plan asistido", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateAssistPlan(input: AssistPlanRequest): Promise<AssistPlanResult> {
  const config = llmConfig();
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
  let candidate = await callAssistLlm(input.goal, input.baseUrl, input.timeoutMs);
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
      candidate = await callAssistLlm(input.goal, input.baseUrl, input.timeoutMs, issueSummary);
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
    throw new AssistPlanError("Plan inválido según guardrails", 400);
  }

  logAssist("Plan asistido validado", {
    steps: parsed.data.steps.length,
    model: config.model,
  });

  return {
    draft: parsed.data,
    meta: {
      goal: input.goal,
      model: config.model,
      generatedAt: new Date().toISOString(),
      promptVersion: "assist-v1",
    },
  };
}
