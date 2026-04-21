import { ChevronDown, ChevronUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssistedMeta, RunRecord, Step } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";

/** Pasos editables en modo Simple (el primer `goto` viene de «URL de inicio»). */
const SIMPLE_ACTION_OPTIONS = [
  { value: "waitForSelector", label: "Esperar selector" },
  { value: "click", label: "Clic" },
  { value: "fill", label: "Rellenar campo" },
  { value: "press", label: "Tecla" },
  { value: "snapshot", label: "Snapshot / a11y" },
] as const;

type SimpleActionKind = (typeof SIMPLE_ACTION_OPTIONS)[number]["value"];

type SimpleRow = {
  id: string;
  action: SimpleActionKind;
  selector: string;
  value: string;
  key: string;
  timeoutMs: string;
};

function newId(): string {
  return crypto.randomUUID();
}

function emptyRow(action: SimpleActionKind = "waitForSelector"): SimpleRow {
  return {
    id: newId(),
    action,
    selector: "",
    value: "",
    key: "Enter",
    timeoutMs: "",
  };
}

/** Conserva la URL de inicio (incluyendo path) como `baseUrl`. */
function parseStartUrl(raw: string): { ok: true; baseUrl: string; gotoPath: string } | { ok: false; message: string } {
  const s = raw.trim();
  if (!s) return { ok: false, message: "Indica la URL de inicio." };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { ok: false, message: "La URL de inicio no es válida." };
  }
  if (!u.hostname) return { ok: false, message: "La URL de inicio no es válida." };
  const baseUrl = `${u.origin}${u.pathname && u.pathname !== "" ? u.pathname : "/"}`;
  const path = u.pathname && u.pathname !== "" ? u.pathname : "/";
  const gotoPath = `${path}${u.search}${u.hash}`;
  return { ok: true, baseUrl, gotoPath };
}

function simpleRowToStep(row: SimpleRow): { ok: true; step: Step } | { ok: false; message: string } {
  switch (row.action) {
    case "waitForSelector": {
      const selector = row.selector.trim();
      if (!selector) return { ok: false, message: "Cada paso «Esperar selector» necesita un selector." };
      const t = row.timeoutMs.trim();
      if (t) {
        const n = Number(t);
        if (!Number.isInteger(n) || n <= 0) return { ok: false, message: "Timeout debe ser un entero positivo (ms)." };
        return { ok: true, step: { action: "waitForSelector", selector, timeoutMs: n } };
      }
      return { ok: true, step: { action: "waitForSelector", selector } };
    }
    case "click": {
      const selector = row.selector.trim();
      if (!selector) return { ok: false, message: "Cada paso «Clic» necesita un selector." };
      return { ok: true, step: { action: "click", selector } };
    }
    case "fill": {
      const selector = row.selector.trim();
      if (!selector) return { ok: false, message: "Cada paso «Rellenar» necesita un selector." };
      return { ok: true, step: { action: "fill", selector, value: row.value } };
    }
    case "press": {
      const key = row.key.trim();
      if (!key) return { ok: false, message: "Cada paso «Tecla» necesita una tecla (ej. Enter, Tab)." };
      return { ok: true, step: { action: "press", key } };
    }
    case "snapshot":
      return { ok: true, step: { action: "snapshot" } };
    default:
      return { ok: false, message: "Tipo de paso no reconocido." };
  }
}

function simpleRowsToExtraSteps(rows: SimpleRow[]): { ok: true; steps: Step[] } | { ok: false; message: string } {
  const steps: Step[] = [];
  for (const row of rows) {
    const r = simpleRowToStep(row);
    if (!r.ok) return r;
    steps.push(r.step);
  }
  return { ok: true, steps };
}

/** JSON = solo pasos después del primer `goto` (la URL de inicio ya abre la página). */
const DEFAULT_STEPS_JSON = JSON.stringify([{ action: "waitForSelector", selector: "h1" }], null, 2);

const RUN_MODE_HELP: Record<"simple" | "advanced" | "assisted", string> = {
  simple:
    "Formulario de pasos (clic, rellenar, esperar selector…). No hace falta JSON: ideal para empezar o pruebas puntuales.",
  advanced:
    "Los mismos pasos en JSON, compatible con el runner. Útil si ya tienes definiciones, copias de otro entorno o quieres control total.",
  assisted:
    "Escribe URL + objetivo. El runner hace recon del accessibility tree, la IA propone los próximos pasos y, si algo falla, un healer intenta recuperarse automáticamente.",
};

type Props = {
  onClose: () => void;
  onRunStarted: (run: RunRecord) => void;
};

type ObserverSnapshot = {
  url: string;
  title: string;
  capturedAt: string;
  treeMarkdown: string;
  nodeCount: number;
};

type AssistPlanResponse = {
  ok: true;
  draft: {
    baseUrl: string;
    steps: Step[];
  };
  meta: AssistedMeta;
  observer?: ObserverSnapshot;
  mode?: "v1" | "v2";
};

export function NewRunModal({ onClose, onRunStarted }: Props) {
  const { projects, activeProjectId } = useAppContext();
  const [tab, setTab] = useState<"simple" | "advanced" | "assisted">("simple");
  const [startUrl, setStartUrl] = useState("https://example.com/");
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [simpleRows, setSimpleRows] = useState<SimpleRow[]>(() => [{ ...emptyRow("waitForSelector"), selector: "h1" }]);

  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS_JSON);
  const [assistGoal, setAssistGoal] = useState("");
  const [assistSteps, setAssistSteps] = useState<Step[]>([]);
  const [assistMeta, setAssistMeta] = useState<AssistedMeta | null>(null);
  const [assistObserver, setAssistObserver] = useState<ObserverSnapshot | null>(null);
  const [victoryText, setVictoryText] = useState("");
  const [victorySelector, setVictorySelector] = useState("");
  const [victoryUrl, setVictoryUrl] = useState("");
  const [victoryMustAll, setVictoryMustAll] = useState(false);
  const [maxHorizons, setMaxHorizons] = useState("12");
  const [stepsPerHorizon, setStepsPerHorizon] = useState("3");
  const [maxLoopMs, setMaxLoopMs] = useState("300000");
  const [memoryMode, setMemoryMode] = useState<"off" | "runtime" | "adaptive">("adaptive");

  useEffect(() => {
    if (projectId) return;
    if (activeProjectId) {
      setProjectId(activeProjectId);
      return;
    }
    if (projects.length > 0) {
      setProjectId(projects[0]!.id);
    }
  }, [activeProjectId, projectId, projects]);

  // Invalidar plan asistido si cambia URL o objetivo.
  useEffect(() => {
    setAssistMeta(null);
    setAssistSteps([]);
    setAssistObserver(null);
  }, [startUrl, assistGoal]);

  function updateRow(id: string, patch: Partial<SimpleRow>) {
    setSimpleRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function setRowAction(id: string, action: SimpleActionKind) {
    setSimpleRows((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r;
        const base = emptyRow(action);
        return { ...base, id: r.id };
      }),
    );
  }

  function moveRow(index: number, dir: -1 | 1) {
    const j = index + dir;
    setSimpleRows((rows) => {
      if (j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }

  async function handleGenerateAssistPlan() {
    setError(null);
    if (!projectId) {
      setError("Debes seleccionar un proyecto para generar un plan.");
      return;
    }
    const goal = assistGoal.trim();
    if (!goal) {
      setError("Escribe un objetivo antes de generar el plan.");
      return;
    }
    const parsedUrl = parseStartUrl(startUrl);
    if (!parsedUrl.ok) {
      setError(parsedUrl.message);
      return;
    }
    setPlanning(true);
    try {
      const res = await apiFetch("/v1/plan", {
        method: "POST",
        body: JSON.stringify({
          project: projectId,
          baseUrl: parsedUrl.baseUrl,
          goal,
          mode: "v2",
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string } & Partial<AssistPlanResponse>;
      if (!res.ok || !body.ok || !body.draft || !body.meta) {
        setAssistMeta(null);
        setAssistSteps([]);
        setAssistObserver(null);
        setError(typeof body.error === "string" ? body.error : "No se pudo generar el plan asistido.");
        return;
      }
      setAssistMeta(body.meta);
      setAssistSteps(body.draft.steps ?? []);
      setAssistObserver(body.observer ?? null);
    } catch (err) {
      setAssistMeta(null);
      setAssistSteps([]);
      setAssistObserver(null);
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setPlanning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!projectId) {
      setError("Debes seleccionar un proyecto para ejecutar la corrida.");
      return;
    }

    const parsedUrl = parseStartUrl(startUrl);
    if (!parsedUrl.ok) {
      setError(parsedUrl.message);
      return;
    }
    const { baseUrl, gotoPath } = parsedUrl;
    const firstGoto: Step = { action: "goto", url: gotoPath };

    let steps: Step[];
    let assisted: AssistedMeta | undefined;
    if (tab === "simple") {
      const built = simpleRowsToExtraSteps(simpleRows);
      if (!built.ok) {
        setError(built.message);
        return;
      }
      steps = [firstGoto, ...built.steps];
    } else if (tab === "advanced") {
      let extra: Step[];
      try {
        extra = JSON.parse(stepsJson) as Step[];
      } catch {
        setError("Los pasos no son JSON válido");
        return;
      }
      if (!Array.isArray(extra)) {
        setError("El JSON debe ser un array de pasos.");
        return;
      }
      if (extra.length > 0 && extra[0]?.action === "goto") {
        setError(
          "Quita el primer «goto» del JSON: la URL de inicio ya hace la primera navegación.",
        );
        return;
      }
      steps = [firstGoto, ...extra];
    } else {
      if (!assistMeta) {
        setError("Primero ejecuta «Reconocer y planear» antes de correr.");
        return;
      }
      if (assistSteps.length === 0) {
        setError("El plan asistido no tiene pasos para ejecutar.");
        return;
      }
      steps = [firstGoto, ...assistSteps];
      assisted = assistMeta;
    }

    setLoading(true);
    let completed: RunRecord | null = null;
    try {
      const body: Record<string, unknown> = {
        baseUrl,
        steps,
        project: projectId,
        ...(assisted ? { assisted } : {}),
        headless: true,
        captureScreenshotAfterEachStep: true,
        recordVideoOnFailure: true,
      };
      if (tab === "assisted" && assisted) {
        const victory = {
          ...(victoryText.trim() ? { textIncludes: [victoryText.trim()] } : {}),
          ...(victorySelector.trim() ? { selectorVisible: [victorySelector.trim()] } : {}),
          ...(victoryUrl.trim() ? { urlIncludes: [victoryUrl.trim()] } : {}),
          mustAll: victoryMustAll,
        };
        body.assist = {
          v2: true,
          goal: assisted.goal,
          ...(victoryText.trim() || victorySelector.trim() || victoryUrl.trim() ? { victory } : {}),
          maxHorizons: Number(maxHorizons) || undefined,
          stepsPerHorizon: Number(stepsPerHorizon) || undefined,
          maxLoopMs: Number(maxLoopMs) || undefined,
          memoryMode,
        };
      }
      const res = await apiFetch("/v1/run", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json()) as { error?: string; details?: unknown };
        setError(
          typeof body.error === "string"
            ? body.error
            : "Error de validación en el servidor (revisa pasos y URL).",
        );
        return;
      }
      const response = (await res.json()) as { id?: string; status?: string };
      if (!response?.id) {
        setError("La respuesta no incluye el ID de la corrida.");
        return;
      }
      // Respuesta fire-and-forget: construimos un RunRecord mínimo en estado "running"
      // y navegamos inmediatamente al detalle, donde el SSE transmitirá eventos en vivo.
      completed = {
        id: response.id,
        status: "running",
        startedAt: new Date().toISOString(),
        durationMs: 0,
        baseUrl: body.baseUrl as string,
        project: projectId,
        steps: [],
      } as RunRecord;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }

    if (!completed) return;
    onRunStarted(completed);
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-hidden rounded-ui border border-border bg-card p-6 shadow-xl">
        <div className="flex shrink-0 items-center justify-between">
          <span className="font-nav-active text-body text-foreground">Nueva corrida</span>
          <button
            type="button"
            onClick={() => { if (!loading) onClose(); }}
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex gap-1 rounded-[8px] bg-muted p-1">
            <button
              type="button"
              onClick={() => setTab("simple")}
              className={`flex-1 rounded-[6px] px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "simple"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setTab("advanced")}
              className={`flex-1 rounded-[6px] px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "advanced"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              Avanzado
            </button>
            <button
              type="button"
              onClick={() => setTab("assisted")}
              className={`flex-1 rounded-[6px] px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "assisted"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              Asistido
            </button>
          </div>
          <p className="text-caption leading-snug text-muted-fg" id="run-mode-hint">
            {RUN_MODE_HELP[tab]}
          </p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
          aria-describedby="run-mode-hint"
        >
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="proj-select">
              Proyecto
            </label>
            <select
              id="proj-select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              <p className="text-caption text-error-fg">
                Crea un proyecto primero para poder ejecutar corridas.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="startUrl">
              URL de inicio
            </label>
            <input
              id="startUrl"
              type="url"
              required
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="https://mi-app.com/login"
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-caption text-muted-fg">
              Se conserva la URL con su ruta (ej. <span className="font-mono">/backoffice</span>) como base y el
              primer paso siempre es <span className="font-mono">goto</span> a esa misma ruta.
            </p>
          </div>

          {tab === "simple" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-caption font-button text-foreground">Pasos</span>
                <button
                  type="button"
                  onClick={() => setSimpleRows((r) => [...r, emptyRow("waitForSelector")])}
                  className="inline-flex items-center gap-1 rounded-pill border border-border px-2.5 py-1 text-caption font-button text-foreground hover:bg-accent"
                >
                  <Plus className="h-3 w-3" strokeWidth={2} />
                  Añadir paso
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {simpleRows.map((row, index) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-2 rounded-[8px] border border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={row.action}
                        onChange={(e) => setRowAction(row.id, e.target.value as SimpleActionKind)}
                        className="min-w-0 flex-1 rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {SIMPLE_ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveRow(index, -1)}
                          className="rounded p-1 text-muted-fg hover:bg-accent hover:text-foreground disabled:opacity-30"
                          aria-label="Subir paso"
                        >
                          <ChevronUp className="h-4 w-4" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          disabled={index === simpleRows.length - 1}
                          onClick={() => moveRow(index, 1)}
                          className="rounded p-1 text-muted-fg hover:bg-accent hover:text-foreground disabled:opacity-30"
                          aria-label="Bajar paso"
                        >
                          <ChevronDown className="h-4 w-4" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSimpleRows((rows) => rows.filter((r) => r.id !== row.id))}
                          className="rounded p-1 text-muted-fg hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Eliminar paso"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={2} />
                        </button>
                      </div>
                    </div>

                    {(row.action === "waitForSelector" || row.action === "click" || row.action === "fill") && (
                      <div className="flex flex-col gap-1">
                        <label className="text-caption text-muted-fg">Selector (CSS o texto Playwright)</label>
                        <input
                          value={row.selector}
                          onChange={(e) => updateRow(row.id, { selector: e.target.value })}
                          placeholder='input[name="email"], button:has-text("OK")'
                          className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    )}

                    {row.action === "waitForSelector" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-caption text-muted-fg">Timeout (ms), opcional</label>
                        <input
                          value={row.timeoutMs}
                          onChange={(e) => updateRow(row.id, { timeoutMs: e.target.value })}
                          placeholder="30000"
                          inputMode="numeric"
                          className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    )}

                    {row.action === "fill" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-caption text-muted-fg">Valor</label>
                        <input
                          value={row.value}
                          onChange={(e) => updateRow(row.id, { value: e.target.value })}
                          placeholder="texto a escribir"
                          className="rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    )}

                    {row.action === "press" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-caption text-muted-fg">Tecla</label>
                        <input
                          value={row.key}
                          onChange={(e) => updateRow(row.id, { key: e.target.value })}
                          placeholder="Enter, Tab, Escape…"
                          className="rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    )}

                    {row.action === "snapshot" && (
                      <p className="text-caption text-muted-fg">
                        Captura snapshot de accesibilidad cuando el runner lo solicite junto con otros flags.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : tab === "advanced" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <label className="text-caption text-muted-fg" htmlFor="stepsJson">
                Pasos después del inicio (JSON)
              </label>
              <p className="text-caption text-muted-fg">
                No incluyas el primer <span className="font-mono">goto</span>: ya se deriva de la URL de inicio. Puede ser un array vacío{" "}
                <span className="font-mono">[]</span> para solo abrir la página.
              </p>
              <textarea
                id="stepsJson"
                rows={10}
                required
                value={stepsJson}
                onChange={(e) => setStepsJson(e.target.value)}
                className="min-h-[200px] flex-1 rounded-[6px] border border-border bg-background px-3 py-2 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-fg" htmlFor="assist-goal">
                  Objetivo
                </label>
                <textarea
                  id="assist-goal"
                  rows={3}
                  value={assistGoal}
                  onChange={(e) => setAssistGoal(e.target.value)}
                  placeholder="Ejemplo: iniciar sesión con usuario y contraseña y llegar al dashboard."
                  className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-caption text-muted-fg">
                  Al cambiar URL u objetivo se invalida el plan generado.
                </p>
              </div>

              <div className="rounded-[8px] border border-border bg-background p-3">
                <p className="mb-2 text-caption font-button text-foreground">Condición de victoria (opcional)</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={victoryText}
                    onChange={(e) => setVictoryText(e.target.value)}
                    placeholder="Texto esperado (ej. Producto creado)"
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={victorySelector}
                    onChange={(e) => setVictorySelector(e.target.value)}
                    placeholder='Selector visible (ej. .toast-success)'
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={victoryUrl}
                    onChange={(e) => setVictoryUrl(e.target.value)}
                    placeholder="URL contiene (ej. /products)"
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <label className="flex items-center gap-2 text-caption text-muted-fg">
                    <input
                      type="checkbox"
                      checked={victoryMustAll}
                      onChange={(e) => setVictoryMustAll(e.target.checked)}
                    />
                    Exigir todas las condiciones
                  </label>
                </div>
              </div>

              <div className="rounded-[8px] border border-border bg-background p-3">
                <p className="mb-2 text-caption font-button text-foreground">Parámetros del loop</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <input
                    value={maxHorizons}
                    onChange={(e) => setMaxHorizons(e.target.value)}
                    inputMode="numeric"
                    placeholder="maxHorizons"
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={stepsPerHorizon}
                    onChange={(e) => setStepsPerHorizon(e.target.value)}
                    inputMode="numeric"
                    placeholder="stepsPerHorizon"
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={maxLoopMs}
                    onChange={(e) => setMaxLoopMs(e.target.value)}
                    inputMode="numeric"
                    placeholder="maxLoopMs"
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <select
                    value={memoryMode}
                    onChange={(e) => setMemoryMode(e.target.value as "off" | "runtime" | "adaptive")}
                    className="rounded-[6px] border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="adaptive">Memoria adaptive</option>
                    <option value="runtime">Solo runtime</option>
                    <option value="off">Sin memoria</option>
                  </select>
                </div>
              </div>

              {!assistMeta ? (
                <div className="flex flex-col items-start gap-2 rounded-[8px] border border-dashed border-border bg-background p-3">
                  <p className="text-caption text-muted-fg">
                    Fase 1 · El runner abrirá la URL, extraerá el accessibility tree y la IA propondrá los próximos {" "}
                    <span className="font-mono">3</span> pasos antes de ejecutar.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleGenerateAssistPlan()}
                    disabled={planning || loading || projects.length === 0 || !assistGoal.trim()}
                    className="rounded-pill bg-primary px-3 py-1.5 text-caption font-button text-primary-fg hover:opacity-95 disabled:opacity-60"
                  >
                    {planning ? "Reconociendo…" : "Reconocer y planear"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {assistObserver && (
                    <details className="rounded-[8px] border border-border bg-background p-3" open>
                      <summary className="cursor-pointer text-caption font-button text-foreground">
                        Mapa semántico observado ({assistObserver.nodeCount} nodos)
                      </summary>
                      <div className="mt-2 flex flex-col gap-1">
                        <p className="text-caption text-muted-fg">
                          <span className="font-mono">{assistObserver.url}</span>
                          {assistObserver.title && <span> · {assistObserver.title}</span>}
                        </p>
                        <pre className="max-h-48 overflow-auto rounded-[4px] bg-muted p-2 font-mono text-caption text-foreground">
                          {assistObserver.treeMarkdown}
                        </pre>
                      </div>
                    </details>
                  )}

                  <div className="rounded-[8px] border border-border bg-background p-3">
                    <p className="mb-2 text-caption font-button text-foreground">
                      Plan propuesto ({assistSteps.length} pasos)
                    </p>
                    {assistSteps.length === 0 ? (
                      <p className="text-caption text-muted-fg">
                        La IA no devolvió pasos válidos. Vuelve a reconocer o ajusta el objetivo.
                      </p>
                    ) : (
                      <ol className="flex flex-col gap-1">
                        {assistSteps.map((step, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-[4px] bg-muted px-2 py-1 font-mono text-caption text-foreground"
                          >
                            <span className="shrink-0 text-muted-fg">#{i + 1}</span>
                            <code className="break-all">{JSON.stringify(step)}</code>
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="mt-2 text-caption text-muted-fg">
                      Durante la ejecución el Strategist puede extender el plan y el Healer intentará corregir cada fallo.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-caption text-muted-fg">
                      Plan generado con <span className="font-mono">{assistMeta.model}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleGenerateAssistPlan()}
                      disabled={planning || loading}
                      className="rounded-pill border border-border px-3 py-1.5 text-caption font-button text-foreground hover:bg-accent disabled:opacity-60"
                    >
                      {planning ? "Reconociendo…" : "Reconocer de nuevo"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="shrink-0 rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">{error}</p>
          )}

          <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => { if (!loading) onClose(); }}
              disabled={loading}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || planning || projects.length === 0 || (tab === "assisted" && !assistMeta)}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-60"
            >
              {loading ? "Ejecutando…" : tab === "assisted" ? "Ejecutar plan" : "Ejecutar"}
            </button>
          </div>
        </form>
      </div>
    </div>

    {loading && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-background/75 backdrop-blur-[3px]"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex max-w-[min(360px,calc(100vw-2rem))] flex-col items-center gap-4 rounded-ui border border-border bg-card px-8 py-7 shadow-xl">
          <Loader2 className="h-10 w-10 animate-spin text-primary" strokeWidth={2} aria-hidden />
          <div className="text-center">
            <p className="text-body font-nav-active text-foreground">Ejecutando la corrida</p>
            <p className="mt-2 text-caption text-muted-fg">
              El navegador está siguiendo los pasos. Puede tardar un minuto o más; no cierres esta ventana.
            </p>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
