import { CheckCircle2, CirclePlay, FolderOpen, Plus, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/app-context";

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
    fetch(`/v1/runs?project=${encodeURIComponent(projectId)}`)
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

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { addProject } = useAppContext();
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    await addProject(label.trim());
    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex w-[400px] flex-col gap-4 rounded-ui border border-border bg-card p-6 shadow-xl">
        <span className="font-nav-active text-body text-foreground">Nuevo proyecto</span>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="proj-label">
              Nombre del proyecto
            </label>
            <input
              id="proj-label"
              type="text"
              required
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="mi-proyecto-web"
              className="rounded-[6px] border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
            >
              {loading ? "Creando…" : "Crear"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectCard({ proj, onOpen }: { proj: { id: string; label: string; color: string }; onOpen: () => void }) {
  const stats = useProjectStats(proj.id);
  const { deleteProject } = useAppContext();

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar proyecto "${proj.label}"?`)) return;
    await deleteProject(proj.id);
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-4 rounded-ui border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-sidebar-active"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: proj.color + "22", color: proj.color }}
        >
          <FolderOpen className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-nav-active text-body text-foreground">{proj.label}</p>
          <p className="text-caption text-muted-fg">{stats.total} ejecuciones</p>
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

      <div className="flex items-center gap-4 rounded-[6px] bg-muted px-3 py-2 text-caption text-muted-fg">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" strokeWidth={2} />
          {stats.pass}
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="h-3 w-3 text-destructive" strokeWidth={2} />
          {stats.fail}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <CirclePlay className="h-3 w-3" strokeWidth={2} />
          Ver ejecuciones →
        </span>
      </div>
    </button>
  );
}

export function Overview() {
  const { projects, setActiveProjectId } = useAppContext();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  function openProject(id: string) {
    setActiveProjectId(id);
    navigate("/runs");
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto pb-4">
        <div className="flex shrink-0 items-center justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-title font-title text-foreground">Proyectos</h2>
            <p className="text-caption text-muted-fg">
              Selecciona un proyecto para ver sus ejecuciones
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2.5 text-small font-button text-primary-fg hover:opacity-95"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Nuevo proyecto
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
