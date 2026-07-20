import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RunRecord } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { useLanguage } from "../context/language-context";
import { apiFetch } from "../lib/api";
import {
  getUserGroupMeta,
  getUserVerdictGroup,
  type UserVerdictGroup,
} from "../lib/verdict";
import { NewRunModal } from "./new-run-modal";

/**
 * Columnas de la tabla (diseño Runs.dc). El objetivo tiene un mínimo de 200px,
 * así que la grilla nunca baja de ~900px: por debajo de eso la tabla scrollea
 * en horizontal en vez de aplastar las celdas.
 */
const GRID_COLUMNS = "110px 120px 185px minmax(200px,1.4fr) 130px 74px 82px";

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
  const [groupFilter, setGroupFilter] = useState<"all" | UserVerdictGroup>("all");
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { activeProjectId, projects, setActiveProjectId } = useAppContext();
  const projectLabelById = new Map(projects.map((p) => [p.id, p.label] as const));

  const visibleRuns = runs.filter((r) => {
    if (projectFilter !== "all" && r.project !== projectFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (groupFilter !== "all" && getUserVerdictGroup(r.verdict, r.status) !== groupFilter) return false;
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
              {t("runs.filter.allProjects")}
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
              { key: "all", label: t("runs.filter.all") },
              { key: "pass", label: t("runs.filter.pass") },
              { key: "fail", label: t("runs.filter.fail") },
              { key: "running", label: t("runs.filter.running") },
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
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as "all" | UserVerdictGroup)}
              className="h-9 rounded-control-sm border border-border bg-card px-2.5 text-small text-foreground outline-none ring-primary focus:ring-2"
              title={t("runs.verdict.filterTitle")}
            >
              <option value="all">{t("runs.verdict.all")}</option>
              {(["success", "fail", "ghostly"] as const).map((g) => (
                <option key={g} value={g}>
                  {t(getUserGroupMeta(g).labelKey)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void fetchRuns()}
              className="flex h-9 w-9 items-center justify-center rounded-control-sm border border-border bg-card text-muted-fg hover:text-foreground"
              title={t("runs.refresh.title")}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-surface border border-border bg-card">
          <div className="ghostly-scrollbar min-h-0 flex-1 overflow-auto">
            <div
              className="sticky top-0 z-10 grid h-11 min-w-[900px] items-center border-b border-border bg-muted px-4 text-caption font-overline uppercase tracking-wider text-muted-fg"
              style={{ gridTemplateColumns: GRID_COLUMNS }}
            >
              <span className="px-1.5">{t("runs.col.id")}</span>
              <span className="px-1.5">{t("runs.col.project")}</span>
              <span className="px-1.5">{t("runs.col.status")}</span>
              <span className="px-1.5">{t("runs.col.goal")}</span>
              <span className="px-1.5">{t("runs.col.start")}</span>
              <span className="px-1.5">{t("runs.col.steps")}</span>
              <span className="px-1.5">{t("runs.col.time")}</span>
            </div>

            {visibleRuns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center text-small text-muted-fg">
                <p>{t("runs.empty.title")}</p>
                <p className="max-w-md text-caption">
                  {t("runs.empty.hintBefore")} <span className="font-nav-active text-foreground">{t("runs.empty.newRun")}</span> {t("runs.empty.hintAfter")}
                </p>
              </div>
            ) : (
              visibleRuns.map((r) => {
                const okSteps = r.steps.filter((s) => s.ok).length;
                const failedStep = r.steps.find((s) => !s.ok);
                const objetivo = r.assisted?.goal?.trim()
                  || (failedStep?.error?.split("\n")[0]?.trim() ?? "")
                  || t("runs.goal.flowRun", { count: r.steps.length });
                // Señal fusionada cara al usuario: 3 grupos (Éxito / Fallo /
                // Fallo de Ghostly). `running` se resuelve aparte.
                const running = r.status === "running";
                const gm = getUserGroupMeta(getUserVerdictGroup(r.verdict, r.status));
                const state = running ? t("runs.status.running") : t(gm.labelKey);

                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/runs/${r.id}`)}
                    className="grid h-14 min-w-[900px] cursor-pointer items-center border-b border-border px-4 text-body transition-colors hover:bg-muted"
                    style={{ gridTemplateColumns: GRID_COLUMNS }}
                  >
                    <span className="truncate px-1.5 font-mono text-small text-muted-fg">
                      {r.id.slice(0, 8)}…
                    </span>
                    <span className="truncate px-1.5 text-body text-foreground">
                      {r.project ? (projectLabelById.get(r.project) ?? r.project) : t("runs.noProject")}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5 px-1.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-pill ${running ? "bg-primary animate-pulse" : gm.dot}`}
                      />
                      <span className={`truncate text-body font-nav-active ${running ? "text-foreground" : gm.text}`}>
                        {state}
                      </span>
                    </span>
                    <span className="truncate px-1.5 text-body text-foreground" title={objetivo}>
                      {objetivo}
                    </span>
                    <span className="truncate px-1.5 font-mono text-small text-muted-fg">
                      {new Date(r.startedAt).toLocaleString(lang, {
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
