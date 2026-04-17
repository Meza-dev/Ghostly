export type RunStatus = "pass" | "fail" | "running";

export type AssistedMeta = {
  goal: string;
  model: string;
  generatedAt: string;
  promptVersion: string;
};

export type StepOutcome = {
  index: number;
  action: string;
  ok: boolean;
  error?: string;
  screenshotPath?: string;
};

export type RunRecord = {
  id: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  baseUrl: string;
  project?: string;
  assisted?: AssistedMeta;
  steps: StepOutcome[];
  videoPath?: string;
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
};

export type PlanAssistResponse = {
  ok: true;
  draft: RunFlowOptions;
  meta: AssistedMeta;
};

export type RunFlowOptions = {
  baseUrl: string;
  steps: Step[];
  project: string;
  assisted?: AssistedMeta;
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

export type GhostTesterClientOptions = {
  /** URL base del servidor GhostTester (ej. http://localhost:4000) */
  baseUrl: string;
  /** API Key generada desde el dashboard de Settings */
  apiKey: string;
};

export class GhostTesterClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: GhostTesterClientOptions) {
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
      throw new Error(`GhostTester API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Ejecuta un flujo de pasos Playwright y retorna el resultado.
   */
  async runFlow(options: RunFlowOptions): Promise<RunRecord> {
    return this.fetch<RunRecord>("/v1/run", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  /**
   * Genera un plan de pasos desde un objetivo en lenguaje natural.
   */
  async planAssist(payload: PlanAssistRequest): Promise<PlanAssistResponse> {
    return this.fetch<PlanAssistResponse>("/v1/plan", {
      method: "POST",
      body: JSON.stringify(payload),
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
