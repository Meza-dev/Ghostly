import { CheckCircle2, CirclePlay, FolderOpen, Plus, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/app-context";
import { apiFetch } from "../lib/api";
import { NewProjectModal } from "./new-project-modal";

type RunSummary = {
  total: number;
  pass: number;
  fail: number;
  lastStatus: "pass" | "fail" | "running" | null;
};

function useProjectStats(projectId: string) {
  const [stats, setStats] = useState<RunSummary>({ total: 0, pass: 0, fail: 0, lastStatus: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/v1/runs?project=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((runs: Array<{ status: string }>) => {
        if (cancelled) return;
        const total = runs.length;
        const pass = runs.filter((r) => r.status === "pass").length;
        const fail = runs.filter((r) => r.status === "fail").length;
        const lastStatus = runs[0]?.status as RunSummary["lastStatus"] ?? null;
        setStats({ total, pass, fail, lastStatus });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  return stats;
}

function ProjectCard({ proj, onOpen }: { proj: { id: string; label: string; color: string }; onOpen: () => void }) {
  const stats = useProjectStats(proj.id);
  const { deleteProject } = useAppContext();
  const coverage = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) : 0;

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar proyecto "${proj.label}"?`)) return;
    await deleteProject(proj.id);
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="ghostly-project-card group flex flex-col gap-3 rounded-surface border border-border bg-card px-5 py-3 text-left hover:-translate-y-0.5 hover:border-border-strong hover:shadow-surface"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-lg border border-border bg-bg-muted transition-transform group-hover:scale-105 group-hover:-rotate-3"
          style={{ backgroundColor: proj.color + "22", color: proj.color }}
        >
          <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-title text-foreground">{proj.label}</p>
          <p className="font-mono text-caption text-muted-fg">{stats.total} ejecuciones</p>
        </div>
        {stats.lastStatus === "pass" && (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} />
        )}
        {stats.lastStatus === "fail" && (
          <XCircle className="h-5 w-5 shrink-0 text-destructive" strokeWidth={2} />
        )}
        <button
          type="button"
          onClick={handleDelete}
          className="ml-1 hidden shrink-0 rounded p-1 text-muted-fg opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-hover:flex"
          aria-label="Eliminar proyecto"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Pasó</p>
          <p className="text-[24px] font-title leading-none tracking-[-0.01em] text-success-fg">{stats.pass}</p>
        </div>
        <div>
          <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Falló</p>
          <p className="text-[24px] font-title leading-none tracking-[-0.01em] text-error-fg">{stats.fail}</p>
        </div>
        <div>
          <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Total</p>
          <p className="text-[24px] font-title leading-none tracking-[-0.01em] text-foreground">{stats.total}</p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2 text-caption text-muted-fg">
        <span className="font-mono">{coverage}% cobertura</span>
        <span className="flex items-center gap-1 text-muted-fg group-hover:text-foreground">
          <CirclePlay className="h-3 w-3" strokeWidth={2} />
          Ver ejecuciones <span className="ghostly-project-card-arrow">→</span>
        </span>
      </div>
    </button>
  );
}

export function Overview() {
  const { projects, setActiveProjectId } = useAppContext();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [totals, setTotals] = useState({ runs: 0, pass: 0, fail: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/v1/runs");
        if (!res.ok) return;
        const runs = (await res.json()) as Array<{ status: string }>;
        if (cancelled) return;
        const pass = runs.filter((r) => r.status === "pass").length;
        const fail = runs.filter((r) => r.status === "fail").length;
        setTotals({ runs: runs.length, pass, fail });
      } catch {
        if (!cancelled) setTotals({ runs: 0, pass: 0, fail: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openProject(id: string) {
    setActiveProjectId(id);
    navigate("/runs");
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-4">
        <div className="flex shrink-0 flex-col gap-5">
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-foreground">
                Proyectos
              </h2>
              <p className="text-small text-muted-fg">
                {projects.length} proyectos · {totals.runs} ejecuciones · {totals.fail} fallidas.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-surface border border-border bg-card px-5 py-4">
              <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Proyectos</p>
              <p className="mt-1 font-serif text-[28px] font-title leading-none tracking-[-0.01em] text-foreground">{projects.length}</p>
            </div>
            <div className="rounded-surface border border-border bg-card px-5 py-4">
              <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Exitosas</p>
              <p className="mt-1 font-serif text-[28px] font-title leading-none tracking-[-0.01em] text-success-fg">{totals.pass}</p>
            </div>
            <div className="rounded-surface border border-border bg-card px-5 py-4">
              <p className="text-overline font-overline uppercase tracking-wide text-muted-fg">Fallidas</p>
              <p className="mt-1 font-serif text-[28px] font-title leading-none tracking-[-0.01em] text-error-fg">{totals.fail}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((proj) => (
            <ProjectCard key={proj.id} proj={proj} onOpen={() => openProject(proj.id)} />
          ))}

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-ui border border-dashed border-border bg-transparent text-muted-fg transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-small font-button">Agregar proyecto</span>
          </button>
        </div>
      </div>

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} />}
    </>
  );
}
