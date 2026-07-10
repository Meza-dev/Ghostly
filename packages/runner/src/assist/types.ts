import type { RunInput, Step } from "../schema.js";

/** Diálogos con role/aria-modal que pasan comprobación de visibilidad en viewport (evita modales solo en HTML). */
export type VisibleDialogInfo = {
  role: string;
  heading?: string;
  ariaLabel?: string;
};

/** Fuente de captura de un error de página (spec 4.1: consola, red, DOM). */
export type PageErrorSource = "console" | "network" | "dom";

/** Severidad conservadora: solo `blocking` corta el loop (Capa 2 — circuit breaker, spec 4.2a). */
export type PageErrorSeverity = "blocking" | "warning";

export type PageErrorDetail = {
  /** network: URL de la request fallida (redactada de secretos). */
  url?: string;
  /** network: status HTTP 4xx/5xx. */
  status?: number;
  /** dom: selector donde se encontró el alert/toast/banner. */
  selector?: string;
};

export type PageError = {
  source: PageErrorSource;
  severity: PageErrorSeverity;
  /** Texto del error, truncado y redactado. */
  message: string;
  detail?: PageErrorDetail;
  /** Índice del paso tras el cual se capturó el error. */
  observedAtStep: number;
};

export type ObserverSnapshot = {
  url: string;
  title: string;
  capturedAt: string;
  treeMarkdown: string;
  nodeCount: number;
  /** Vacío o ausente si no hay ninguno visible. */
  visibleDialogs?: VisibleDialogInfo[];
  /** Errores de página capturados por la Capa 1 (consola, red, DOM) desde el último snapshot. */
  pageErrors: PageError[];
};

/**
 * Taxonomía de veredictos del run (spec §5). Fase 2a solo produce `fail-app-bug`
 * (mapeo directo desde el circuit breaker); el resto de los valores los
 * emitirán las fases posteriores (victoria verificada → `success`, juez →
 * el resto de la zona gris).
 */
export type Verdict =
  | "success"
  | "fail-app-bug"
  | "fail-test-broken"
  | "fail-agent-lost"
  | "inconclusive-environment"
  | "inconclusive";

/**
 * Motivos de `stopReason` que representan un punto de disparo hacia el juez
 * (spec §4.3 — Capa 3, tabla de triggers). El juez todavía no existe (GHOST-29);
 * estos valores son el contrato de espera: cuando el pipeline llega a uno de
 * estos casos, NO decide el desenlace por heurística ni delega en el
 * strategist — se detiene con uno de estos `stopReason` y deja el veredicto
 * sin resolver (`verdict` ausente) para que la fase 3a los consuma.
 */
export type JudgeTriggerStopReason =
  | "needs-judge:victory-candidate"
  | "needs-judge:no-victory-condition"
  | "needs-judge:stalled"
  | "needs-judge:budget-exhausted";

export type SemanticHint = {
  role?: string;
  name?: string;
  placeholder?: string;
  confidence?: number;
};

export type AssistEventType =
  | "recon"
  | "plan_chunk"
  | "loop_state"
  | "horizon_start"
  | "horizon_end"
  | "victory_check"
  | "memory_hit"
  | "memory_miss"
  | "step_start"
  | "step_success"
  | "step_failure"
  | "heal_start"
  | "heal_action"
  | "heal_success"
  | "heal_failure"
  | "judge_verdict"
  | "run_end";

export type AssistEvent = {
  seq: number;
  type: AssistEventType;
  at: string;
  stepIndex?: number;
  payload: Record<string, unknown>;
};

export type VictoryCondition = {
  textIncludes?: string[];
  selectorVisible?: string[];
  urlIncludes?: string[];
  mustAll?: boolean;
  /**
   * Double-check de persistencia (spec §4.2b): tras un candidato a victoria en un
   * objetivo que implica persistir estado (crear/guardar/enviar), el motor recarga
   * la página y re-verifica la condición antes de declarar éxito. Poner `false`
   * para flujos con estado efímero/multi-paso (wizards) donde una recarga rompería
   * el flujo legítimamente — opt-out explícito (spec §9, riesgo mitigado).
   * Default: `true` cuando el goal parece implicar persistencia.
   */
  revalidate?: boolean;
};

export type MemoryMode = "off" | "runtime" | "adaptive";

export type CodeInputHint = {
  testId?: string;
  ariaLabel?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  type?: string;
};

export type CodeFormHint = {
  name: string;
  file?: string;
  inputs?: CodeInputHint[];
  submitTestId?: string;
  submitLabel?: string;
};

export type CodeComponentHint = {
  name: string;
  file?: string;
  testIds?: string[];
  ariaLabels?: string[];
  roles?: string[];
};

export type CodeRouteHint = {
  path: string;
  component?: string;
};

export type CodeHints = {
  components?: CodeComponentHint[];
  forms?: CodeFormHint[];
  routes?: CodeRouteHint[];
  selectors?: {
    byTestId?: Record<string, string>;
    byAriaLabel?: Record<string, string>;
  };
};

export type AssistRunOptions = {
  v2: true;
  goal: string;
  /**
   * Modo de ejecución estricta para planes completos confiables (ej. MCP avanzado):
   * evita cortar por victory temprana antes de consumir el plan de entrada.
   */
  isFullPlan?: boolean;
  maxHealingAttemptsPerStep?: number;
  observerMaxNodes?: number;
  victory?: VictoryCondition;
  maxHorizons?: number;
  stepsPerHorizon?: number;
  maxLoopMs?: number;
  /**
   * Tiempo máximo (ms) a esperar a que desaparezcan textos típicos de carga en modales
   * (p. ej. «Cargando documentos») antes de planificar o entre pasos. Por defecto 180000.
   */
  modalLoaderMaxWaitMs?: number;
  memoryMode?: MemoryMode;
  /**
   * Semilla opcional de pasos aprendidos de corridas previas.
   * Campo interno (servidor) para bootstrapping de memoria durable.
   */
  seedMemorySteps?: Step[];
  /**
   * Cuando es true y hay semilla durable, prioriza replay del flujo guardado.
   * Campo interno (servidor).
   */
  replayFromMemory?: boolean;
};

export type AssistedRunInput = RunInput & {
  assist?: AssistRunOptions;
};

export type PlannedStep = {
  step: Step;
  hint?: SemanticHint;
  rationale?: string;
};

export type PlannedChunk = {
  steps: PlannedStep[];
  hasMore: boolean;
};

export type PlanProgressItem = {
  step: Step;
  status: "pending" | "ok" | "failed" | "dropped";
  source?: "input" | "seed" | "strategist" | "replan" | "healer";
  horizon?: number;
  stepIndex?: number;
  note?: string;
  stateBefore?: string;
  stateAfter?: string;
  stateChanged?: boolean;
};

export type PlanProgressReportItem = Omit<PlanProgressItem, "step"> & {
  step: Record<string, unknown>;
};

export type StrategistContext = {
  goal: string;
  baseUrl: string;
  snapshot: ObserverSnapshot;
  victory?: VictoryCondition;
  history: Array<{ step: Step; ok: boolean; error?: string }>;
  planProgress?: PlanProgressItem[];
  maxSteps: number;
  /**
   * Pista textual del juez tras un veredicto `continue` (spec §4.3 regla 5):
   * "hay un modal de confirmación tapando el botón; cerralo primero". Solo
   * presente en el horizonte inmediatamente siguiente a la intervención del
   * juez — el strategist la recibe como contexto adicional, nunca como una
   * instrucción ejecutable directa (el juez clasifica, no actúa).
   */
  judgeHint?: string;
};

export type StrategistFn = (ctx: StrategistContext) => Promise<PlannedChunk>;

export type HealerContext = {
  goal: string;
  baseUrl: string;
  snapshot: ObserverSnapshot;
  codeHints?: CodeHints;
  failedStep: Step;
  error: string;
  history?: Array<{ step: Step; ok: boolean; error?: string }>;
};

export type HealerResult = {
  steps: Step[];
  rationale?: string;
};

export type HealerFn = (ctx: HealerContext) => Promise<HealerResult>;

/**
 * Motivo por el que el motor invoca al juez (spec §4.3 — tabla de triggers).
 * `error-signal` cubre `PageError` de severidad `warning` que el circuit
 * breaker (Capa 2a) no resuelve por sí solo (los `blocking` mapean directo a
 * `fail-app-bug` sin pasar por el juez). Los otros 4 valores corresponden 1:1
 * a los `JudgeTriggerStopReason` que la Capa 2 (Fase 2b) ya produce:
 * `victory-candidate`, `stalled`, `budget-exhausted` y el caso "sin condición
 * configurada" (que también entra como `victory-candidate` — el juez decide
 * sobre la misma zona gris, sea que la condición exista o no). `healing-exhausted`
 * es neto-nuevo de esta fase: el healer agotó sus intentos sobre un paso.
 */
export type JudgeTrigger =
  | "error-signal"
  | "victory-candidate"
  | "stalled"
  | "healing-exhausted"
  | "budget-exhausted";

/** Resultado de un check determinista de Capa 2 (p. ej. una condición de victoria individual). */
export type JudgeDeterministicCheck = {
  check: string;
  passed: boolean;
};

/** Una acción reciente del historial, resumida para el dossier del juez (spec §4.3). */
export type JudgeRecentAction = {
  step: string;
  outcome: "ok" | "failed" | "healed";
  error?: string;
};

/**
 * El expediente que recibe el juez (spec §4.3) — un paquete curado, NO el
 * snapshot crudo. `screenshot` queda deliberadamente fuera del contrato del
 * runner: el provider-gating (adjuntar imagen solo si el LLM del usuario
 * soporta multimodal) es responsabilidad del lado API (GHOST-30); el runner
 * nunca decide ni construye evidencia visual.
 */
export type JudgeDossier = {
  goal: string;
  victoryCondition?: VictoryCondition;
  reason: JudgeTrigger;
  recentActions: JudgeRecentAction[];
  currentSnapshot: string;
  snapshotDiff: string;
  pageErrors: PageError[];
  deterministicChecks: JudgeDeterministicCheck[];
  /** Opcional/omitido en el runner (spec §4.3) — el provider-gating de imágenes es GHOST-30. */
  screenshot?: Buffer;
};

/** Confianza del juez en su propio veredicto (spec §4.3). */
export type JudgeConfidence = "high" | "medium" | "low";

/**
 * Salida del juez (spec §4.3 — contrato estricto). `continue` es el único
 * veredicto no terminal: el motor sigue el loop con el `hint` opcional
 * como contexto adicional para el strategist. El resto detiene el run.
 */
export type JudgeVerdict = {
  verdict:
    | "continue"
    | "success"
    | "fail-app-bug"
    | "fail-test-broken"
    | "fail-agent-lost"
    | "inconclusive-environment"
    | "inconclusive";
  confidence: JudgeConfidence;
  reasoning: string;
  evidence: string[];
  /** Solo relevante cuando `verdict === "continue"`. */
  hint?: string;
};

/**
 * Función inyectada del juez (mismo patrón de inyección que `StrategistFn`/
 * `HealerFn` — el runner NUNCA importa un LLM; la implementación real vive
 * del lado API, GHOST-30). Recibe el dossier curado y devuelve un veredicto
 * ya validado (la validación Zod + reintento vive en `judge.ts`, no acá).
 */
export type JudgeFn = (dossier: JudgeDossier) => Promise<JudgeVerdict>;

/** Un evento de invocación del juez, para observabilidad (spec §4.3, `judgeEvents[]`). */
export type JudgeEvent = {
  reason: JudgeTrigger;
  dossierSummary: {
    goal: string;
    reason: JudgeTrigger;
    recentActionsCount: number;
    pageErrorsCount: number;
  };
  verdict: JudgeVerdict;
  at: string;
};
