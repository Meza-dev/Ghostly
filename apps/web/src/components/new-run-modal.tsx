import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssistedMeta, RunRecord, Step } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";

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

/** JSON = solo pasos después del primer `goto` (la URL de inicio ya abre la página). */
const DEFAULT_STEPS_JSON = JSON.stringify([{ action: "waitForSelector", selector: "h1" }], null, 2);

const RUN_MODE_HELP: Record<"advanced" | "assisted", string> = {
  advanced: "Pasos en JSON compatibles con el runner. Para flujos ya definidos o control total.",
  assisted: "Indica URL, objetivo y, si quieres, una condición de éxito. Al ejecutar se planifica y corre el flujo en un solo paso.",
};

type Props = {
  onClose: () => void;
  onRunStarted: (run: RunRecord) => void;
};

type AssistPlanResponse = {
  ok: true;
  draft: {
    baseUrl: string;
    steps: Step[];
  };
  meta: AssistedMeta;
  mode?: "v1" | "v2";
};

export function NewRunModal({ onClose, onRunStarted }: Props) {
  const { projects, activeProjectId } = useAppContext();
  const [tab, setTab] = useState<"assisted" | "advanced">("assisted");
  const [assistAvailable, setAssistAvailable] = useState(true);
  const [assistChecked, setAssistChecked] = useState(false);
  const [startUrl, setStartUrl] = useState("https://example.com/");
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS_JSON);
  const [assistGoal, setAssistGoal] = useState("");
  const [victoryText, setVictoryText] = useState("");
  const [victorySelector, setVictorySelector] = useState("");
  const [victoryUrl, setVictoryUrl] = useState("");
  const [victoryMustAll, setVictoryMustAll] = useState(false);

  const submitDisabledReason = (() => {
    if (loading) return "Hay una ejecución iniciándose.";
    if (planning) return "Generando plan asistido…";
    if (projects.length === 0) return "No hay proyectos disponibles. Crea uno primero.";
    if (!assistChecked) return "Validando configuración del modo asistido...";
    if (tab === "assisted" && !assistAvailable) {
      return "Modo asistido no disponible: configura una API key de IA en el servidor.";
    }
    if (tab === "assisted" && !assistGoal.trim()) return "Escribe un objetivo para el modo asistido.";
    return null;
  })();
  const isSubmitDisabled = submitDisabledReason !== null;

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/v1/ping");
        const body = (await res.json()) as { assistConfigured?: boolean };
        if (cancelled) return;
        const enabled = Boolean(body.assistConfigured);
        setAssistAvailable(enabled);
        if (!enabled) setTab("advanced");
      } catch {
        if (cancelled) return;
        setAssistAvailable(false);
        setTab("advanced");
      } finally {
        if (!cancelled) setAssistChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!projectId) {
      setError("Debes seleccionar un proyecto para ejecutar la ejecución.");
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
    if (tab === "advanced") {
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
      setLoading(true);
    } else {
      const goal = assistGoal.trim();
      if (!goal) {
        setError("Escribe un objetivo para el modo asistido.");
        return;
      }
      setPlanning(true);
      let planBody: AssistPlanResponse;
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
          setError(typeof body.error === "string" ? body.error : "No se pudo generar el plan asistido.");
          setPlanning(false);
          return;
        }
        planBody = body as AssistPlanResponse;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error de red");
        setPlanning(false);
        return;
      }
      const plannedSteps = planBody.draft.steps ?? [];
      if (plannedSteps.length === 0) {
        setError("El plan asistido no incluye pasos ejecutables. Ajusta el objetivo e inténtalo de nuevo.");
        setPlanning(false);
        return;
      }
      steps = [firstGoto, ...plannedSteps];
      assisted = planBody.meta;
      setLoading(true);
      setPlanning(false);
    }
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
          maxHorizons: 12,
          stepsPerHorizon: 3,
          maxLoopMs: 300_000,
          memoryMode: "adaptive",
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
        setError("La respuesta no incluye el ID de la ejecución.");
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
          <span className="font-nav-active text-body text-foreground">Nueva ejecución</span>
          <button
            type="button"
            onClick={() => { if (!loading && !planning) onClose(); }}
            disabled={loading || planning}
            className="flex h-7 w-7 items-center justify-center rounded-control-md text-muted-fg hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex gap-1 rounded-control-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                if (assistAvailable) setTab("assisted");
              }}
              disabled={!assistAvailable}
              className={`flex-1 rounded-control-md px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "assisted"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              Asistido
            </button>
            <button
              type="button"
              onClick={() => setTab("advanced")}
              className={`flex-1 rounded-control-md px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "advanced"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              Avanzado
            </button>
          </div>
          <p className="text-caption leading-snug text-muted-fg" id="run-mode-hint">
            {RUN_MODE_HELP[tab]}
          </p>
          {!assistAvailable && (
            <p className="text-caption text-warning-fg">
              Modo asistido deshabilitado: falta API key de IA en el backend. Ejecuta{" "}
              <span className="font-mono">ghostly config</span> y reinicia <span className="font-mono">ghostly up</span>.
            </p>
          )}
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
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              <p className="text-caption text-error-fg">
                Crea un proyecto primero para poder ejecutar ejecuciones.
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
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-caption text-muted-fg">
              La ruta forma parte de la base; la ejecución abre esa URL como primer paso.
            </p>
          </div>

          {tab === "advanced" ? (
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
                className="min-h-[200px] flex-1 rounded-control-md border border-border bg-background px-3 py-2 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                  className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="rounded-control-lg border border-border bg-background p-3">
                <p className="mb-2 text-caption font-button text-foreground">Condición de éxito (opcional)</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={victoryText}
                    onChange={(e) => setVictoryText(e.target.value)}
                    placeholder="Texto esperado (ej. Producto creado)"
                    className="rounded-control-md border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={victorySelector}
                    onChange={(e) => setVictorySelector(e.target.value)}
                    placeholder='Selector visible (ej. .toast-success)'
                    className="rounded-control-md border border-border bg-card px-2 py-1.5 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <input
                    value={victoryUrl}
                    onChange={(e) => setVictoryUrl(e.target.value)}
                    placeholder="URL contiene (ej. /products)"
                    className="rounded-control-md border border-border bg-card px-2 py-1.5 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
            </div>
          )}

          {error && (
            <p className="shrink-0 rounded-control-sm bg-error px-3 py-2 text-caption text-error-fg">{error}</p>
          )}

          <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => { if (!loading && !planning) onClose(); }}
              disabled={loading || planning}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-60"
            >
              {loading ? "Ejecutando…" : "Ejecutar"}
            </button>
          </div>
          {submitDisabledReason && (
            <p className="text-right text-caption text-muted-fg">{submitDisabledReason}</p>
          )}
        </form>
      </div>
    </div>

    {(loading || planning) && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-background/75 backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex max-w-[min(360px,calc(100vw-2rem))] flex-col items-center gap-4 rounded-ui border border-border bg-card px-8 py-7 shadow-xl">
          <Loader2 className="h-10 w-10 animate-spin text-primary" strokeWidth={2} aria-hidden />
          <div className="text-center">
            <p className="text-body font-nav-active text-foreground">
              {planning && !loading ? "Generando plan" : "Ejecutando"}
            </p>
            <p className="mt-2 text-caption text-muted-fg">
              {planning && !loading
                ? "Analizando la página y preparando los pasos. Un momento."
                : "El navegador está siguiendo el flujo. Puede tardar varios minutos; no cierres esta ventana."}
            </p>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
