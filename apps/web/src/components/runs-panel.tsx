import { CirclePlay, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunRecord } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";
import { NewRunModal } from "./new-run-modal";

function StatusBadge({ status }: { status: RunRecord["status"] }) {
  if (status === "pass") {
    return (
      <span className="inline-flex items-center rounded-pill bg-success px-2.5 py-1 text-badge font-badge text-success-fg">
        Pasó
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex items-center rounded-pill bg-error px-2.5 py-1 text-badge font-badge text-error-fg">
        Falló
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-pill bg-warning px-2.5 py-1 text-badge font-badge text-warning-fg">
      Corriendo
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function RunsPanel() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { activeProjectId } = useAppContext();

  // El filtro ahora lo hace la API via ?project=... — runs ya viene filtrado
  const visibleRuns = runs;

  const fetchRuns = useCallback(async () => {
    try {
      const url = activeProjectId ? `/v1/runs?project=${encodeURIComponent(activeProjectId)}` : "/v1/runs";
      const res = await apiFetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as RunRecord[];
      setRuns(data);
    } catch {
      // ignorar errores de red silenciosamente
    }
  }, [activeProjectId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns, activeProjectId]);

  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === "running");
    if (hasRunning && !intervalRef.current) {
      intervalRef.current = setInterval(() => void fetchRuns(), 5000);
    } else if (!hasRunning && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runs, fetchRuns]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="flex shrink-0 items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-caption font-button text-muted-fg">
              {runs.length} ejecución{runs.length !== 1 ? "es" : ""}
            </span>
            <button
              type="button"
              onClick={() => void fetchRuns()}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[6px] border border-border bg-background text-muted-fg hover:text-foreground"
              title="Refrescar"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2.5 text-small font-button text-primary-fg hover:opacity-95"
          >
            <CirclePlay className="h-3.5 w-3.5" strokeWidth={2} />
            Nueva corrida
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-ui border border-border bg-card">
          <div
            className="grid shrink-0 border-b border-border bg-muted px-2.5 py-2 text-caption font-button text-muted-fg"
            style={{ gridTemplateColumns: "130px 88px minmax(0,1fr) 120px 80px 64px minmax(0,1fr)" }}
          >
            <span className="px-1.5">Run ID</span>
            <span className="px-1.5 text-center">Estado</span>
            <span className="px-1.5">URL base</span>
            <span className="px-1.5">Inicio</span>
            <span className="px-1.5">Pasos</span>
            <span className="px-1.5">Tiempo</span>
            <span className="px-1.5">Resultado</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {visibleRuns.length === 0 ? (
              <div className="flex h-full items-center justify-center text-small text-muted-fg">
                Sin ejecuciones aún. Lanza una corrida para empezar.
              </div>
            ) : (
              visibleRuns.map((r, i) => {
                const okSteps = r.steps.filter((s) => s.ok).length;
                const failedStep = r.steps.find((s) => !s.ok);
                const resultado = r.status === "pass"
                  ? `${okSteps}/${r.steps.length} pasos · sin fallos`
                  : failedStep
                    ? `Paso ${failedStep.index + 1}/${r.steps.length} · ${failedStep.error?.split("\n")[0] ?? "error"}`
                    : `${okSteps}/${r.steps.length} pasos`;

                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/runs/${r.id}`)}
                    className={`grid cursor-pointer border-b border-border px-2.5 py-2 text-small hover:bg-accent ${
                      i % 2 === 1 ? "bg-muted" : ""
                    }`}
                    style={{ gridTemplateColumns: "130px 88px minmax(0,1fr) 120px 80px 64px minmax(0,1fr)" }}
                  >
                    <span className="truncate px-1.5 font-nav-active text-foreground">
                      {r.id.slice(0, 8)}…
                    </span>
                    <span className="flex justify-center px-1.5">
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="truncate px-1.5 text-foreground">{r.baseUrl}</span>
                    <span className="truncate px-1.5 text-muted-fg">
                      {new Date(r.startedAt).toLocaleString("es", {
                        day: "2-digit", month: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    <span className="px-1.5 text-muted-fg">{okSteps}/{r.steps.length}</span>
                    <span className="px-1.5 text-muted-fg">{formatDuration(r.durationMs)}</span>
                    <span
                      className={`truncate px-1.5 font-nav ${
                        r.status === "fail" ? "text-error-fg" :
                        r.status === "running" ? "text-muted-fg" : "text-foreground"
                      }`}
                    >
                      {resultado}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <NewRunModal
          onClose={() => setShowModal(false)}
          onRunStarted={() => {
            setShowModal(false);
            void fetchRuns();
          }}
        />
      )}
    </>
  );
}
