export type RunStatus = "pass" | "fail" | "running";

export type AssistedMeta = {
  goal: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
  assistConfig?: {
    victory?: {
      textIncludes?: string[];
      selectorVisible?: string[];
      urlIncludes?: string[];
      mustAll?: boolean;
    };
    maxHorizons?: number;
    stepsPerHorizon?: number;
    maxLoopMs?: number;
    memoryMode?: "off" | "runtime" | "adaptive";
  };
};

export type StepOutcome = {
  index: number;
  action: string;
  ok: boolean;
  error?: string;
  screenshotPath?: string;
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

export type RunStartResponse = {
  ok: true;
  id: string;
  status: "running";
};

export type RunRecord = {
  id: string;
  status: RunStatus;
  /** Taxonomía de veredictos (spec §5). `undefined` en runs históricos ("sin clasificar"). */
  verdict?: string;
  /** Razonamiento del juez o descripción del check determinista que resolvió el veredicto. */
  verdictReason?: string;
  /** `stopReason` interno del pipeline (spec §6) — por qué terminó el loop. */
  stopReason?: string;
  startedAt: string;
  durationMs: number;
  baseUrl: string;
  project?: string;
  assisted?: AssistedMeta;
  steps: StepOutcome[];
  videoPath?: string;
  events?: AssistEvent[];
};

export type Step =
  | { action: "goto"; url: string }
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string }
  | { action: "press"; key: string }
  | { action: "waitForSelector"; selector: string; timeoutMs?: number }
  | { action: "snapshot" };

export type PlanAssistRequest = {
  project: string;
  baseUrl: string;
  goal: string;
  mode?: "v1" | "v2";
};

export type ObserverSnapshot = {
  url: string;
  title: string;
  capturedAt: string;
  treeMarkdown: string;
  nodeCount: number;
};

export type PlanAssistResponse = {
  ok: true;
  draft: RunFlowOptions;
  meta: AssistedMeta;
  observer?: ObserverSnapshot;
  mode?: "v1" | "v2";
};

export type AssistRunOptions = {
  v2: true;
  goal: string;
  maxHealingAttemptsPerStep?: number;
  observerMaxNodes?: number;
  victory?: {
    textIncludes?: string[];
    selectorVisible?: string[];
    urlIncludes?: string[];
    mustAll?: boolean;
  };
  maxHorizons?: number;
  stepsPerHorizon?: number;
  maxLoopMs?: number;
  memoryMode?: "off" | "runtime" | "adaptive";
};

export type RunFlowOptions = {
  baseUrl: string;
  steps: Step[];
  project: string;
  assisted?: AssistedMeta;
  assist?: AssistRunOptions;
  headless?: boolean;
  captureScreenshotAfterEachStep?: boolean;
  recordVideoOnFailure?: boolean;
  artifactsDir?: string;
  defaultTimeoutMs?: number;
};

export type Project = {
  id: string;
  label: string;
  color: string;
  createdAt: string;
};

export type GhostlyClientOptions = {
  /** URL base del servidor Ghostly (ej. http://localhost:4000) */
  baseUrl: string;
  /** API Key generada desde el dashboard de Settings */
  apiKey: string;
};

export class GhostlyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: GhostlyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("X-Api-Key", this.apiKey);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ghostly API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Inicia un flujo Playwright en modo fire-and-forget. El API acepta la petición
   * y ejecuta la corrida en background. Devuelve el id para consultar/streamear estado.
   */
  async startRun(options: RunFlowOptions): Promise<RunStartResponse> {
    return this.fetch<RunStartResponse>("/v1/run", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  /**
   * @deprecated Usa `startRun` + `waitForRun` o el endpoint SSE de eventos.
   * Inicia una corrida y hace polling hasta que termina. Mantiene la API antigua.
   */
  async runFlow(options: RunFlowOptions, opts?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<RunRecord> {
    const started = await this.startRun(options);
    return this.waitForRun(started.id, opts);
  }

  /**
   * Hace polling del endpoint de detalle hasta que el run salga de `running`.
   * Útil para integraciones que no pueden usar SSE (ej. CLI, scripts).
   */
  async waitForRun(
    id: string,
    opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<RunRecord> {
    const pollMs = Math.max(250, opts.pollIntervalMs ?? 1_000);
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60 * 1_000);
    let last: RunRecord | null = null;
    while (Date.now() < deadline) {
      const record = await this.getRun(id);
      last = record;
      if (record.status !== "running") return record;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (last) return last;
    throw new Error(`waitForRun: timeout esperando run ${id}`);
  }

  /**
   * Devuelve la URL SSE para stream de eventos en vivo de una corrida.
   * El token JWT se añade como query string porque EventSource no soporta headers.
   */
  runEventsUrl(id: string, token: string): string {
    return `${this.baseUrl}/v1/runs/${id}/events/stream?token=${encodeURIComponent(token)}`;
  }

  /**
   * Genera un plan de pasos desde un objetivo en lenguaje natural (modo v1 por defecto).
   */
  async planAssist(payload: PlanAssistRequest): Promise<PlanAssistResponse> {
    return this.fetch<PlanAssistResponse>("/v1/plan", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /**
   * Asistido v2: hace recon del accessibility tree y devuelve el plan inicial + snapshot observador.
   */
  async planAssistV2(
    payload: Omit<PlanAssistRequest, "mode">,
  ): Promise<PlanAssistResponse> {
    return this.fetch<PlanAssistResponse>("/v1/plan", {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "v2" }),
    });
  }

  /**
   * Lista todos los runs del usuario (opcionalmente filtrado por proyecto).
   */
  async listRuns(project?: string): Promise<RunRecord[]> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : "";
    return this.fetch<RunRecord[]>(`/v1/runs${qs}`);
  }

  /**
   * Obtiene el detalle de un run por ID.
   */
  async getRun(id: string): Promise<RunRecord> {
    return this.fetch<RunRecord>(`/v1/runs/${id}`);
  }

  /**
   * Lista los proyectos del usuario.
   */
  async listProjects(): Promise<Project[]> {
    return this.fetch<Project[]>("/v1/projects");
  }

  /**
   * Crea un nuevo proyecto.
   */
  async createProject(label: string, color?: string): Promise<Project> {
    return this.fetch<Project>("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ label, color }),
    });
  }
}
