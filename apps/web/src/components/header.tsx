import { GitBranch } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAppContext } from "../context/app-context";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/runs": "Ejecuciones",
  "/flows": "Flujos & casos",
  "/settings": "Preferencias",
};

export function Header() {
  const { projects, activeProjectId, setActiveProjectId } = useAppContext();
  const location = useLocation();

  const title = Object.entries(TITLES).find(([path]) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path),
  )?.[1] ?? "GhostTester";

  return (
    <header className="flex shrink-0 items-start justify-between gap-6 px-8 pb-3 pt-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h1 className="text-title font-title text-foreground">{title}</h1>
        {location.pathname.startsWith("/runs") && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveProjectId(null)}
              className={`inline-flex items-center rounded-pill border px-3.5 py-1.5 text-small transition-colors ${
                activeProjectId === null
                  ? "border-primary bg-sidebar-active font-nav-active text-primary"
                  : "border-border bg-card font-nav text-muted-fg hover:border-primary hover:text-primary"
              }`}
            >
              Todos
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveProjectId(p.id)}
                className={`inline-flex items-center rounded-pill border px-3.5 py-1.5 text-small transition-colors ${
                  activeProjectId === p.id
                    ? "border-primary bg-sidebar-active font-nav-active text-primary"
                    : "border-border bg-card font-nav text-muted-fg hover:border-primary hover:text-primary"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-caption text-muted-fg">
          {location.pathname === "/"
            ? "Selecciona un proyecto para ver sus ejecuciones"
            : "Vista de ejecuciones · filtra por proyecto desde las etiquetas"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 rounded-[10px] border border-border bg-card px-3.5 py-2">
        <GitBranch className="h-4 w-4 text-muted-fg" strokeWidth={2} />
        <span className="text-small font-nav-active text-foreground">main</span>
      </div>
    </header>
  );
}
