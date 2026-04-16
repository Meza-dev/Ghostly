import { ArrowLeft, CheckCircle, Film, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RunRecord } from "../../../../packages/runner/src/schema.js";

function artifactUrl(filePath: string): string {
  // Extrae todo lo que va después de "artifacts\" o "artifacts/"
  // y construye la URL relativa /artifacts/run-xxx/step-N-ok.png
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/artifacts/";
  const idx = normalized.indexOf(marker);
  const relative = idx !== -1 ? normalized.slice(idx + marker.length) : normalized.split("/").pop() ?? "";
  return `/artifacts/${relative}`;
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/v1/runs/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json() as Promise<RunRecord>;
      })
      .then((data) => { if (data) setRun(data); })
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-fg">
        <p className="text-body">Run no encontrado</p>
        <button type="button" onClick={() => navigate("/")} className="text-small text-primary underline">
          Volver al listado
        </button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center text-small text-muted-fg">
        Cargando…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-4">
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-small text-muted-fg hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Volver
        </button>
        <span className="text-caption text-muted-fg">/</span>
        <span className="truncate font-nav-active text-foreground text-small">{run.id}</span>
      </div>

      <div className="flex shrink-0 flex-wrap gap-4 rounded-ui border border-border bg-card px-4 py-3 text-small">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Estado</span>
          <span className={run.status === "pass" ? "text-success-fg font-button" : "text-error-fg font-button"}>
            {run.status === "pass" ? "Pasó" : run.status === "fail" ? "Falló" : "Corriendo"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">URL base</span>
          <span className="text-foreground">{run.baseUrl}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Duración</span>
          <span className="text-foreground">{(run.durationMs / 1000).toFixed(2)}s</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Inicio</span>
          <span className="text-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        {run.videoPath && (
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-fg">Video</span>
            <a
              href={artifactUrl(run.videoPath)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Film className="h-3.5 w-3.5" strokeWidth={2} />
              Ver video
            </a>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {run.steps.map((step, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-ui border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-2">
              {step.ok ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-success-fg" strokeWidth={2} />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-error-fg" strokeWidth={2} />
              )}
              <span className="font-nav-active text-small text-foreground">
                Paso {i + 1} — {step.action}
              </span>
            </div>

            {step.error && (
              <p className="rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">
                {step.error}
              </p>
            )}

            {step.screenshotPath && (
              <img
                src={artifactUrl(step.screenshotPath)}
                alt={`Screenshot paso ${i + 1}`}
                className="max-h-64 w-full rounded-[4px] border border-border object-contain object-top"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
