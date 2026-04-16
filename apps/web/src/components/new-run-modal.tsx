import { X } from "lucide-react";
import { useState } from "react";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";

const DEFAULT_STEPS = JSON.stringify(
  [
    { action: "goto", url: "/" },
    { action: "waitForSelector", selector: "h1" },
  ],
  null,
  2,
);

type Props = {
  onClose: () => void;
  onRunStarted: () => void;
};

export function NewRunModal({ onClose, onRunStarted }: Props) {
  const { projects, activeProjectId } = useAppContext();
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS);
  const [projectId, setProjectId] = useState(activeProjectId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let steps: unknown;
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      setError("Los pasos no son JSON válido");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/v1/run", {
        method: "POST",
        body: JSON.stringify({
          baseUrl,
          steps,
          project: projectId || undefined,
          headless: true,
          captureScreenshotAfterEachStep: true,
          recordVideoOnFailure: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Error desconocido");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-[520px] flex-col gap-4 rounded-ui border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="font-nav-active text-body text-foreground">Nueva corrida</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-accent"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
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
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="baseUrl">
              URL base
            </label>
            <input
              id="baseUrl"
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="stepsJson">
              Pasos (JSON)
            </label>
            <textarea
              id="stepsJson"
              rows={8}
              required
              value={stepsJson}
              onChange={(e) => setStepsJson(e.target.value)}
              className="rounded-[6px] border border-border bg-background px-3 py-2 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">{error}</p>
          )}

          <div className="flex justify-end gap-2">
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
