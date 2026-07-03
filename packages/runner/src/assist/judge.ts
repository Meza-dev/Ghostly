/**
 * El juez — contrato, dossier builder, serialización de prompt y cap de
 * intervenciones (Capa 3, spec §4.3).
 *
 * Este módulo NUNCA importa un LLM ni hace I/O: el runner define el CONTRATO
 * (tipos + validación Zod), construye el dossier a partir del estado del
 * pipeline, serializa ese dossier a texto (`JUDGE_SYSTEM_PROMPT` +
 * `buildJudgeUserPrompt`, funciones/constantes PURAS), y ofrece el tracker
 * puro del límite de `continue` por motivo. Mantener la serialización acá
 * (en vez de en apps/api) es deliberado: apps/api no tiene test runner, así
 * que toda la lógica de prompt queda cubierta por vitest con LLM mocks. La
 * llamada REAL al LLM del usuario (`createJudge`, provider HTTP/CLI,
 * screenshot gating por capacidad del provider) vive del lado API
 * (`apps/api/src/services/assist-orchestrator.ts`, GHOST-30) e inyecta su
 * función vía `AssistedDeps.judge`, exactamente como strategist/healer.
 */
import { z } from "zod";
import type { Step } from "../schema.js";
import type {
  JudgeDeterministicCheck,
  JudgeDossier,
  JudgeFn,
  JudgeRecentAction,
  JudgeTrigger,
  JudgeVerdict,
  ObserverSnapshot,
  PageError,
  VictoryCondition,
} from "./types.js";

export type { JudgeDossier, JudgeFn, JudgeTrigger, JudgeVerdict };

/** Cuántas acciones recientes del historial entran al dossier (spec §4.3, default 8). */
const RECENT_ACTIONS_LIMIT = 8;

/** Límite de veredictos `continue` del juez por el MISMO motivo dentro de un run (spec §4.3 regla 5). */
export const MAX_CONTINUE_VERDICTS_PER_REASON = 2;

/** Zod schema del contrato estricto del juez (spec §4.3). Valida la salida cruda del LLM. */
export const judgeVerdictSchema: z.ZodType<JudgeVerdict> = z.object({
  verdict: z.enum([
    "continue",
    "success",
    "fail-app-bug",
    "fail-test-broken",
    "fail-agent-lost",
    "inconclusive-environment",
    "inconclusive",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().min(1),
  evidence: z.array(z.string()),
  hint: z.string().min(1).optional(),
});

/**
 * Veredicto de repliegue cuando el juez produce output malformado dos veces
 * seguidas (mismo patrón que `sanitizeHealerSteps`: no propaga el error crudo
 * al loop, degrada a un valor seguro). `inconclusive` es la elección correcta
 * per spec §4.3: preferible a mentir, nunca `success` por defecto.
 */
function judgeFailureFallback(): JudgeVerdict {
  return {
    verdict: "inconclusive",
    confidence: "low",
    reasoning:
      "El juez devolvió una salida malformada dos veces seguidas (falló la validación del contrato Zod). " +
      "No se puede confiar en el veredicto — se degrada a inconclusive en vez de asumir cualquier otro resultado.",
    evidence: [],
  };
}

/**
 * Invoca `judgeCall`, valida el resultado con `judgeVerdictSchema`, y reintenta
 * UNA vez ante output malformado (parseo Zod fallido o excepción del callback,
 * p. ej. timeout del LLM). Si el segundo intento también falla, degrada a
 * `judgeFailureFallback()`. Idéntico patrón al sanitizador del healer: nunca
 * deja pasar un veredicto no validado al pipeline.
 */
export async function validateJudgeVerdict(
  judgeCall: () => Promise<unknown>,
): Promise<JudgeVerdict> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await judgeCall();
      const parsed = judgeVerdictSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      // Reintenta como si hubiera sido malformado — el segundo intento decide.
    }
  }
  return judgeFailureFallback();
}

/**
 * Contador puro del límite de intervenciones `continue` por motivo (spec §4.3
 * regla 5): "máximo 2 intervenciones continue del juez por run; a la tercera
 * invocación por el mismo motivo debe emitir veredicto terminal." El cap es
 * por `JudgeTrigger`, no global — un run puede acumular 2 `continue` por
 * `stalled` Y 2 más por `error-signal` de forma independiente.
 */
export type JudgeContinueCapTracker = {
  /** true si todavía queda presupuesto de `continue` para este motivo. */
  canContinue: (reason: JudgeTrigger) => boolean;
  /** Registra que el juez devolvió `continue` para este motivo. */
  recordContinue: (reason: JudgeTrigger) => void;
};

export function createJudgeContinueCapTracker(): JudgeContinueCapTracker {
  const counts = new Map<JudgeTrigger, number>();
  return {
    canContinue(reason) {
      return (counts.get(reason) ?? 0) < MAX_CONTINUE_VERDICTS_PER_REASON;
    },
    recordContinue(reason) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    },
  };
}

/** Resume un `Step` a texto legible para `JudgeRecentAction.step` y para el diff de snapshot. */
function describeStep(step: Step): string {
  switch (step.action) {
    case "goto":
      return `goto ${step.url}`;
    case "click":
      return `click ${step.selector}`;
    case "fill":
      return `fill ${step.selector}`;
    case "press":
      return `press ${step.key}`;
    case "waitForSelector":
      return `waitForSelector ${step.selector}`;
    case "snapshot":
      return "snapshot";
    default: {
      const exhaustive: never = step;
      throw new Error(`Step action desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function toRecentAction(entry: { step: Step; ok: boolean; error?: string; healed?: boolean }): JudgeRecentAction {
  const outcome: JudgeRecentAction["outcome"] = entry.healed ? "healed" : entry.ok ? "ok" : "failed";
  return {
    step: describeStep(entry.step),
    outcome,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

/** Placeholder explícito de `snapshotDiff` cuando no hay snapshot previo (p. ej. trigger en el primer paso). */
const NO_PREVIOUS_SNAPSHOT_PLACEHOLDER = "(sin snapshot previo)";

function summarizeSnapshot(snapshot: ObserverSnapshot): string {
  return `${snapshot.url} | ${snapshot.title} | nodes=${snapshot.nodeCount}\n${snapshot.treeMarkdown}`;
}

/**
 * Diff textual simple entre dos snapshots — clave para que el juez detecte
 * "no pasó nada" en el trigger `stalled` (spec §4.3). No pretende ser un diff
 * estructural: alcanza con exponer si URL/título/árbol cambiaron y en qué.
 */
function diffSnapshots(previous: ObserverSnapshot | undefined, current: ObserverSnapshot): string {
  if (!previous) return NO_PREVIOUS_SNAPSHOT_PLACEHOLDER;
  const lines: string[] = [];
  if (previous.url !== current.url) {
    lines.push(`url: "${previous.url}" -> "${current.url}"`);
  }
  if (previous.title !== current.title) {
    lines.push(`title: "${previous.title}" -> "${current.title}"`);
  }
  if (previous.treeMarkdown === current.treeMarkdown) {
    lines.push("tree: sin cambios (diff vacío)");
  } else {
    lines.push("tree: cambió (ver currentSnapshot para el estado completo)");
  }
  return lines.join("\n");
}

export type BuildJudgeDossierInput = {
  goal: string;
  victoryCondition?: VictoryCondition;
  reason: JudgeTrigger;
  history: Array<{ step: Step; ok: boolean; error?: string; healed?: boolean }>;
  currentSnapshot: ObserverSnapshot;
  previousSnapshot?: ObserverSnapshot;
  pageErrors: PageError[];
  deterministicChecks: JudgeDeterministicCheck[];
  /**
   * Buffer crudo del screenshot (PNG), si el caller lo capturó (spec §4.3 —
   * evidencia visual "híbrido según provider"). El dossier SIEMPRE puede
   * traerlo — la decisión de ENVIARLO al LLM (según si el provider soporta
   * imágenes) es 100% responsabilidad de la capa API (`createJudge`,
   * GHOST-30); esta función solo lo transporta sin interpretarlo.
   */
  screenshot?: Buffer;
};

/**
 * Ensambla el dossier del juez (spec §4.3) a partir del estado curado del
 * pipeline. Función pura respecto de Playwright/LLM — no abre páginas ni
 * llama a un modelo; el screenshot (si viene) ya fue capturado por el caller
 * (`invokeJudge` en `pipeline.ts`) y acá solo se transporta sin decidir nada
 * sobre si debe enviarse a un LLM (eso es API-side, GHOST-30).
 */
export function buildJudgeDossier(input: BuildJudgeDossierInput): JudgeDossier {
  const recentActions = input.history.slice(-RECENT_ACTIONS_LIMIT).map(toRecentAction);
  return {
    goal: input.goal,
    ...(input.victoryCondition ? { victoryCondition: input.victoryCondition } : {}),
    reason: input.reason,
    recentActions,
    currentSnapshot: summarizeSnapshot(input.currentSnapshot),
    snapshotDiff: diffSnapshots(input.previousSnapshot, input.currentSnapshot),
    pageErrors: input.pageErrors,
    deterministicChecks: input.deterministicChecks,
    ...(input.screenshot ? { screenshot: input.screenshot } : {}),
  };
}

/**
 * Prompt de sistema del juez (spec §4.3 — "Reglas de comportamiento del
 * juez", las 5 reglas van textualmente al prompt de sistema). Vive en el
 * runner (no en apps/api) porque es un artefacto PURO — texto estático, sin
 * LLM, sin I/O — y así queda cubierto por el mismo test runner (vitest) que
 * el resto del contrato del juez. `createJudge` (apps/api, GHOST-30) solo lo
 * importa y lo pasa como mensaje `system` al LLM del usuario.
 *
 * Estilo alineado con `STRATEGIST_SYSTEM`/`HEALER_SYSTEM` en
 * `assist-orchestrator.ts`: español, reglas numeradas, taxonomía explícita.
 */
export const JUDGE_SYSTEM_PROMPT = [
  "Eres el Juez de un runner E2E asistido (Ghostly v2, Capa 3 — spec §4.3).",
  "Recibes un EXPEDIENTE (dossier) curado sobre un run que llegó a una zona gris que las reglas deterministas del motor no pudieron resolver por sí solas: objetivo, condición de victoria (si existe), motivo de tu invocación, acciones recientes, snapshot actual, diff contra el snapshot anterior, errores de página capturados y el resultado de los checks deterministas ya evaluados.",
  "",
  "REGLA 1 — Clasificás, no actuás: JAMÁS proponés ni ejecutás pasos. A lo sumo devolvés una 'hint' textual (SOLO cuando verdict='continue') que el strategist recibirá como contexto adicional, nunca como instrucción ejecutable directa.",
  "",
  "REGLA 2 — Sesgo ANTI-FALSO-ÉXITO (el más importante): solo declarás verdict='success' si podés CITAR evidencia concreta del dossier que lo PRUEBE (un check determinista que pasó, un texto que persiste, una URL correcta). En la duda, SIEMPRE 'inconclusive' — nunca 'success'. Un falso fallo molesta; un falso éxito destruye la confianza en el producto. Es preferible reportar de más 'inconclusive' que arriesgar un solo falso éxito.",
  "",
  "REGLA 3 — No contradecís la evidencia dura: si `deterministicChecks` trae un check de victoria fallido (`passed: false`), verdict='success' está PROHIBIDO — como mucho podés explicar por qué falló usando otro veredicto (fail-app-bug, fail-test-broken, etc). La jerarquía de autoridad es evidencia determinista > juez > strategist: nunca podés declarar éxito CONTRA un check determinista fallido.",
  "",
  "REGLA 4 — Distinguís responsables (tu trabajo central). Usá EXACTAMENTE estos 7 valores de `verdict`:",
  "  - 'continue': el test sigue — obstáculo recuperable (modal, cookie banner, paso intermedio faltante). Requiere `hint`.",
  "  - 'success': objetivo cumplido y RESPALDADO por evidencia citable del dossier.",
  "  - 'fail-app-bug': la app bajo prueba está rota (500, crash, dato que no persiste). El test HIZO su trabajo: encontró un bug real — no es vergüenza, es el valor del producto.",
  "  - 'fail-test-broken': el plan, los datos o la condición de victoria están mal definidos. No dice nada sobre la app.",
  "  - 'fail-agent-lost': Ghostly no encontró el camino aunque existía (selector mal resuelto sin evidencia de error de la app). Métrica de calidad interna del motor.",
  "  - 'inconclusive-environment': timeout, app caída, red rota. No es culpa de la app ni del agente — es el entorno.",
  "  - 'inconclusive': la evidencia disponible no alcanza para afirmar ningún otro veredicto con confianza. Preferible a mentir.",
  "",
  "REGLA 5 — 'continue' es legítimo solo ante un obstáculo RECUPERABLE con una `hint` concreta y accionable para el strategist (ej. 'hay un modal de confirmación tapando el botón; cerralo primero'). Límite estricto: máximo 2 intervenciones 'continue' del motor por el MISMO motivo dentro de un run — a la 3ra invocación por el mismo motivo, el motor fuerza un veredicto terminal sin importar tu respuesta. No insistas con 'continue' si ya diste una hint similar antes sin resultado.",
  "",
  "FORMATO DE RESPUESTA — SOLO un objeto JSON, sin markdown ni texto extra, con forma EXACTA:",
  '{ "verdict": string, "confidence": "high" | "medium" | "low", "reasoning": string, "evidence": string[], "hint"?: string }',
  "- `reasoning`: explicación citando evidencia CONCRETA del dossier (qué check, qué error, qué diff) — nunca una afirmación genérica sin respaldo.",
  "- `evidence`: array de referencias puntuales al dossier (ej. 'deterministicChecks: victory.met=false', 'pageErrors[0]: 500 en POST /save').",
  "- `hint`: SOLO presente cuando `verdict` es 'continue'.",
].join("\n");

/** Describe una acción reciente del dossier para el prompt de usuario del juez. */
function describeRecentActionForPrompt(action: JudgeRecentAction, index: number): string {
  const suffix = action.error ? ` — error: ${action.error}` : "";
  return `  ${index + 1}. [${action.outcome}] ${action.step}${suffix}`;
}

/** Describe un error de página del dossier para el prompt de usuario del juez. */
function describePageErrorForPrompt(error: PageError): string {
  const detailParts: string[] = [];
  if (error.detail?.url) detailParts.push(`url=${error.detail.url}`);
  if (error.detail?.status !== undefined) detailParts.push(`status=${error.detail.status}`);
  if (error.detail?.selector) detailParts.push(`selector=${error.detail.selector}`);
  const detail = detailParts.length > 0 ? ` (${detailParts.join(", ")})` : "";
  return `  - [${error.severity}/${error.source}] ${error.message}${detail}`;
}

/** Describe un check determinista del dossier para el prompt de usuario del juez. */
function describeDeterministicCheckForPrompt(check: JudgeDeterministicCheck): string {
  return `  - ${check.check}: ${check.passed ? "true (pasó)" : "false (falló)"}`;
}

function describeVictoryConditionForPrompt(victory: VictoryCondition | undefined): string {
  if (!victory) return "Condición de victoria: (sin condición configurada)";
  const lines = [
    "Condición de victoria configurada:",
    `  - textIncludes: ${JSON.stringify(victory.textIncludes ?? [])}`,
    `  - selectorVisible: ${JSON.stringify(victory.selectorVisible ?? [])}`,
    `  - urlIncludes: ${JSON.stringify(victory.urlIncludes ?? [])}`,
    `  - mustAll: ${String(victory.mustAll ?? false)}`,
  ];
  return lines.join("\n");
}

/**
 * Serializa el dossier del juez (spec §4.3) a un prompt de usuario en texto
 * plano — el mismo dossier que recibe `deps.judge(dossier)` en el pipeline,
 * ahora convertido a texto legible por el LLM. Función PURA (sin I/O, sin
 * LLM): probada con mocks en `judge-prompt.test.ts`. Este texto es SIEMPRE
 * autosuficiente por contrato (spec §4.3 "híbrido según provider") — nunca
 * menciona ni depende de un screenshot; el adjunto de imagen (si el provider
 * lo soporta) se agrega aparte, a nivel de mensaje LLM, en `createJudge`
 * (apps/api, GHOST-30).
 */
/**
 * Forma mínima de `AssistedRunResult` (pipeline.ts) que necesita el guardia
 * de memoria — estructural a propósito para no crear una dependencia
 * circular de tipos con `pipeline.ts` (que ya importa de `judge.ts`).
 */
export type MemoryGuardRunResult = {
  ok: boolean;
  verdict?: Exclude<JudgeVerdict["verdict"], "continue">;
};

/**
 * Guardia de memoria (spec §6 — doble confirmación): `AssistMemory` SOLO
 * puede persistirse cuando el desenlace es una victoria puramente
 * determinista, NUNCA cuando el "success" viene del juez.
 *
 * Por construcción del pipeline (`pipeline.ts`), una victoria determinista
 * limpia (`checkImmediateVictory`/`evaluateVictory`, sin pasar por el juez)
 * jamás setea `result.verdict` — el campo queda `undefined`, solo
 * `result.ok === true` la marca. El juez SÍ setea `verdict` explícitamente
 * vía `applyTerminalJudgeVerdict`, incluso cuando devuelve `"success"` — pero
 * el juez solo se invoca cuando la Capa 2 (checks deterministas) ya agotó lo
 * que podía resolver gratis (spec §3, jerarquía de autoridad). Un
 * `verdict === "success"` del juez es la ÚNICA confirmación (de un LLM), no
 * una SEGUNDA confirmación sobre una base determinista — por eso NO
 * habilita memoria. Esto también evita el caso peor: un LLM con un sesgo
 * distinto al anti-falso-éxito del prompt (o un provider con salida ruidosa)
 * envenenando la memoria de replay con pasos de un run que nunca pasó un
 * check determinista real.
 */
export function qualifiesForMemoryPersistence(result: MemoryGuardRunResult): boolean {
  if (!result.ok) return false;
  if (result.verdict !== undefined) return false;
  return true;
}

export function buildJudgeUserPrompt(dossier: JudgeDossier): string {
  const recentActionsBlock = dossier.recentActions.length > 0
    ? dossier.recentActions.map(describeRecentActionForPrompt).join("\n")
    : "  (sin acciones recientes registradas)";
  const pageErrorsBlock = dossier.pageErrors.length > 0
    ? dossier.pageErrors.map(describePageErrorForPrompt).join("\n")
    : "  (sin errores de página — ninguno capturado por la Capa 1)";
  const deterministicChecksBlock = dossier.deterministicChecks.length > 0
    ? dossier.deterministicChecks.map(describeDeterministicCheckForPrompt).join("\n")
    : "  (sin checks deterministas evaluados para este trigger)";

  return [
    `Objetivo: ${dossier.goal}`,
    `Motivo de la invocación (reason): ${dossier.reason}`,
    "",
    describeVictoryConditionForPrompt(dossier.victoryCondition),
    "",
    "Acciones recientes (orden cronológico, más reciente al final):",
    recentActionsBlock,
    "",
    "Errores de página capturados (Capa 1):",
    pageErrorsBlock,
    "",
    "Checks deterministas evaluados (Capa 2):",
    deterministicChecksBlock,
    "",
    "Diff contra el snapshot anterior (clave para detectar 'no pasó nada'):",
    dossier.snapshotDiff,
    "",
    "Snapshot actual (mapa semántico completo):",
    dossier.currentSnapshot,
  ].join("\n");
}
