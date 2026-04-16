import { CirclePlay, FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/app-context";

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const { addProject } = useAppContext();
  const [label, setLabel] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    addProject(label.trim());
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
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95"
            >
              Crear
            </button>
          </div>
        </form>
      </div>
    </div>
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
            <button
              key={proj.id}
              type="button"
              onClick={() => openProject(proj.id)}
              className="flex flex-col gap-4 rounded-ui border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-sidebar-active"
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
                  <p className="text-caption text-muted-fg">proyecto</p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-[6px] bg-muted px-3 py-2">
                <CirclePlay className="h-3.5 w-3.5 shrink-0 text-muted-fg" strokeWidth={2} />
                <span className="text-caption text-muted-fg">Ver ejecuciones →</span>
              </div>
            </button>
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
