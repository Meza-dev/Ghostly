import type { RunInput, Step } from "../schema.js";

/** Diálogos con role/aria-modal que pasan comprobación de visibilidad en viewport (evita modales solo en HTML). */
export type VisibleDialogInfo = {
  role: string;
  heading?: string;
  ariaLabel?: string;
};

/** Fuente de captura de un error de página (spec 4.1: consola, red, DOM). */
export type PageErrorSource = "console" | "network" | "dom";

/** Severidad conservadora: solo `blocking` corta el loop (Capa 2, fuera de esta fase). */
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
