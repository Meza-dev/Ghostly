import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Step } from "../../../../packages/runner/src/schema.js";
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

/** `baseUrl` = origin; primer paso = goto a path+query+hash de la misma URL. */
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
  const baseUrl = u.origin;
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

type Props = {
  onClose: () => void;
  onRunStarted: () => void;
};

export function NewRunModal({ onClose, onRunStarted }: Props) {
  const { projects, activeProjectId } = useAppContext();
  const [tab, setTab] = useState<"simple" | "advanced">("simple");
  const [startUrl, setStartUrl] = useState("https://example.com/");
  const [projectId, setProjectId] = useState(activeProjectId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [simpleRows, setSimpleRows] = useState<SimpleRow[]>(() => [{ ...emptyRow("waitForSelector"), selector: "h1" }]);

  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS_JSON);
  const [headless, setHeadless] = useState(true);
  const [captureScreenshotAfterEachStep, setCaptureScreenshotAfterEachStep] = useState(true);
  const [recordVideoOnFailure, setRecordVideoOnFailure] = useState(true);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedUrl = parseStartUrl(startUrl);
    if (!parsedUrl.ok) {
      setError(parsedUrl.message);
      return;
    }
    const { baseUrl, gotoPath } = parsedUrl;
    const firstGoto: Step = { action: "goto", url: gotoPath };

    let steps: Step[];
    if (tab === "simple") {
      const built = simpleRowsToExtraSteps(simpleRows);
      if (!built.ok) {
        setError(built.message);
        return;
      }
      steps = [firstGoto, ...built.steps];
    } else {
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
    }

    setLoading(true);
    try {
      const res = await apiFetch("/v1/run", {
        method: "POST",
        body: JSON.stringify({
          baseUrl,
          steps,
          project: projectId || undefined,
          headless,
          captureScreenshotAfterEachStep,
          recordVideoOnFailure,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; details?: unknown };
        setError(
          typeof body.error === "string"
            ? body.error
            : "Error de validación en el servidor (revisa pasos y URL).",
        );
        return;
      }
      onRunStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-hidden rounded-ui border border-border bg-card p-6 shadow-xl">
        <div className="flex shrink-0 items-center justify-between">
          <span className="font-nav-active text-body text-foreground">Nueva corrida</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-accent"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 rounded-[8px] bg-muted p-1">
          <button
            type="button"
            onClick={() => setTab("simple")}
            className={`flex-1 rounded-[6px] px-3 py-2 text-small font-button transition-colors ${
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
            className={`flex-1 rounded-[6px] px-3 py-2 text-small font-button transition-colors ${
              tab === "advanced"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-fg hover:text-foreground"
            }`}
          >
            Avanzado (JSON)
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="proj-select">
              Proyecto
            </label>
            <select
              id="proj-select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Sin proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
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
              Se usa el <span className="font-mono">origin</span> como base y el primer paso siempre es{" "}
              <span className="font-mono">goto</span> a la ruta de esta URL. Los pasos de abajo son a partir de ahí.
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
          ) : (
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
          )}

          <fieldset className="flex shrink-0 flex-col gap-2 rounded-[8px] border border-border bg-muted/40 px-3 py-2">
            <legend className="px-1 text-caption font-button text-muted-fg">Opciones de ejecución</legend>
            <label className="flex items-center gap-2 text-caption text-foreground">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                className="rounded border-border"
              />
              Navegador sin cabeza (headless)
            </label>
            <label className="flex items-center gap-2 text-caption text-foreground">
              <input
                type="checkbox"
                checked={captureScreenshotAfterEachStep}
                onChange={(e) => setCaptureScreenshotAfterEachStep(e.target.checked)}
                className="rounded border-border"
              />
              Captura de pantalla tras cada paso
            </label>
            <label className="flex items-center gap-2 text-caption text-foreground">
              <input
                type="checkbox"
                checked={recordVideoOnFailure}
                onChange={(e) => setRecordVideoOnFailure(e.target.checked)}
                className="rounded border-border"
              />
              Video si falla
            </label>
          </fieldset>

          {error && (
            <p className="shrink-0 rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">{error}</p>
          )}

          <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-60"
            >
              {loading ? "Ejecutando…" : "Ejecutar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
