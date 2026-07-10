import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RunRecord } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";
import { ALL_VERDICTS, getVerdictMeta, type Verdict } from "../lib/verdict";
import { NewRunModal } from "./new-run-modal";
import { VerdictBadge } from "./verdict-badge";

function StatusBadge({ status }: { status: RunRecord["status"] }) {
  if (status === "pass") {
    return (
      <span className="inline-flex h-5 items-center rounded-pill bg-success px-2 py-0 text-badge font-badge text-success-fg">
        Pasó
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex h-5 items-center rounded-pill bg-error px-2 py-0 text-badge font-badge text-error-fg">
        Falló
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center rounded-pill bg-warning px-2 py-0 text-badge font-badge text-warning-fg">
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
  const [statusFilter, setStatusFilter] = useState<"all" | "pass" | "fail" | "running">("all");
  const [projectFilter, setProjectFilter] = useState<string | "all">("all");
  const [verdictFilter, setVerdictFilter] = useState<"all" | Verdict>("all");
  const navigate = useNavigate();
  const location = useLocation();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { activeProjectId, projects, setActiveProjectId } = useAppContext();
  const projectLabelById = new Map(projects.map((p) => [p.id, p.label] as const));

  const visibleRuns = runs.filter((r) => {
    if (projectFilter !== "all" && r.project !== projectFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (verdictFilter !== "all" && r.verdict !== verdictFilter) return false;
    return true;
  });

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
    if (!activeProjectId) {
      setProjectFilter("all");
      return;
    }
    setProjectFilter(activeProjectId);
  }, [activeProjectId]);

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

  useEffect(() => {
    const onNewRun = () => setShowModal(true);
    window.addEventListener("ghostly:new-run", onNewRun);
    return () => window.removeEventListener("ghostly:new-run", onNewRun);
  }, []);

  useEffect(() => {
    const st = location.state as { openNewRun?: boolean } | null | undefined;
    if (!st?.openNewRun) return;
    setShowModal(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setProjectFilter("all");
                setActiveProjectId(null);
              }}
              className={`h-7 rounded-pill border px-3 text-small font-button ${
                projectFilter === "all"
                  ? "border-primary bg-brand-primary-soft text-primary"
                  : "border-border bg-card text-muted-fg hover:border-border-strong hover:text-foreground"
              }`}
            >
              Todos
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setProjectFilter(project.id);
                  setActiveProjectId(project.id);
                }}
                className={`h-7 rounded-pill border px-3 text-small font-button ${
                  projectFilter === project.id
                    ? "border-primary bg-brand-primary-soft text-primary"
                    : "border-border bg-card text-muted-fg hover:border-border-strong hover:text-foreground"
                }`}
              >
                {project.label}
              </button>
            ))}
            <span className="ml-auto" />
            <div className="inline-flex items-center rounded-control-sm border border-border bg-card p-0.5">
              {[
              { key: "all", label: "Todos" },
              { key: "pass", label: "Pass" },
              { key: "fail", label: "Fail" },
              { key: "running", label: "Run" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key as "all" | "pass" | "fail" | "running")}
                className={`h-7 rounded-control-sm px-3 text-small ${
                  statusFilter === item.key
                    ? "bg-bg-muted text-foreground"
                    : "text-muted-fg hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
            </div>
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value as "all" | Verdict)}
              className="h-9 rounded-control-sm border border-border bg-card px-2.5 text-small text-foreground outline-none ring-primary focus:ring-2"
              title="Filtrar por veredicto"
            >
              <option value="all">Todos los veredictos</option>
              {ALL_VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {getVerdictMeta(v).shortLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void fetchRuns()}
              className="flex h-9 w-9 items-center justify-center rounded-control-sm border border-border bg-card text-muted-fg hover:text-foreground"
              title="Refrescar lista"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-surface border border-border bg-card">
          <div
            className="grid h-11 shrink-0 items-center border-b border-border bg-muted px-3 text-caption font-overline uppercase tracking-wide text-muted-fg"
            style={{ gridTemplateColumns: "120px 110px 88px 130px minmax(0,1.35fr) 140px 84px 84px" }}
          >
            <span className="px-1.5">Run ID</span>
            <span className="px-1.5">Proyecto</span>
            <span className="px-1.5 text-center">Estado</span>
            <span className="px-1.5">Veredicto</span>
            <span className="px-1.5">Objetivo</span>
            <span className="px-1.5">Inicio</span>
            <span className="px-1.5">Pasos</span>
            <span className="px-1.5">Tiempo</span>
          </div>

          <div className="ghostly-scrollbar min-h-0 flex-1 overflow-auto">
            {visibleRuns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-small text-muted-fg">
                <p>Aún no hay ejecuciones en esta vista.</p>
                <p className="max-w-md text-caption">
                  Pulsa <span className="font-nav-active text-foreground">Nueva ejecución</span> para empezar a ejecutar tus pruebas.
                </p>
              </div>
            ) : (
              visibleRuns.map((r) => {
                const okSteps = r.steps.filter((s) => s.ok).length;
                const failedStep = r.steps.find((s) => !s.ok);
                const objetivo = r.assisted?.goal?.trim()
                  || (failedStep?.error?.split("\n")[0]?.trim() ?? "")
                  || `Ejecución de flujo (${r.steps.length} pasos)`;

                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/runs/${r.id}`)}
                    className="grid h-12 cursor-pointer items-center border-b border-border px-3 text-body transition-colors hover:bg-muted"
                    style={{ gridTemplateColumns: "120px 110px 88px 130px minmax(0,1.35fr) 140px 84px 84px" }}
                  >
                    <span className="truncate px-1.5 font-mono text-small text-muted-fg">
                      {r.id.slice(0, 8)}…
                    </span>
                    <span className="truncate px-1.5 text-body text-foreground">
                      {r.project ? (projectLabelById.get(r.project) ?? r.project) : "Sin proyecto"}
                    </span>
                    <span className="flex justify-center px-1.5">
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="px-1.5">
                      {r.status !== "running" && <VerdictBadge verdict={r.verdict} status={r.status} size="sm" />}
                    </span>
                    <span className="truncate px-1.5 text-small text-foreground">{objetivo}</span>
                    <span className="truncate px-1.5 font-mono text-small text-muted-fg">
                      {new Date(r.startedAt).toLocaleString("es", {
                        day: "2-digit", month: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    <span className="px-1.5 font-mono text-small text-muted-fg">{okSteps}/{r.steps.length}</span>
                    <span className="px-1.5 font-mono text-small text-muted-fg">{formatDuration(r.durationMs)}</span>
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
          onRunStarted={(run) => {
            setShowModal(false);
            void fetchRuns();
            navigate(`/runs/${run.id}`);
          }}
        />
      )}
    </>
  );
}
