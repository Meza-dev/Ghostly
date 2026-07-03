/**
 * El juez — contrato, dossier builder y cap de intervenciones (Capa 3, spec §4.3).
 *
 * Este módulo NUNCA importa un LLM: el runner solo define el CONTRATO (tipos +
 * validación Zod), construye el dossier a partir del estado del pipeline, y
 * ofrece el tracker puro del límite de `continue` por motivo. La implementación
 * real del juez (prompt de sistema, provider LLM, screenshot gating) vive del
 * lado API (`apps/api/src/services/assist-orchestrator.ts`, `createJudge` —
 * GHOST-30) e inyecta su función vía `AssistedDeps.judge`, exactamente como
 * strategist/healer.
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
};

/**
 * Ensambla el dossier del juez (spec §4.3) a partir del estado curado del
 * pipeline. Función pura — no toca Playwright ni hace I/O. `screenshot` queda
 * fuera intencionalmente (provider-gating es responsabilidad de GHOST-30).
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
  };
}
