import { GitBranch } from "lucide-react";

const projects = [
  { id: "gt", label: "ghosttester-ai", active: true },
  { id: "acme", label: "acme-web", active: false },
] as const;

export function Header() {
  return (
    <header className="flex shrink-0 items-start justify-between gap-6 px-8 pb-3 pt-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h1 className="text-title font-title text-foreground">Panel de ejecuciones</h1>
        <div className="flex flex-wrap items-center gap-2">
          {projects.map((p) =>
            p.active ? (
              <span
                key={p.id}
                className="inline-flex items-center rounded-pill border border-primary bg-sidebar-active px-3.5 py-1.5 text-small font-nav-active text-primary"
              >
                {p.label}
              </span>
            ) : (
              <span
                key={p.id}
                className="inline-flex items-center rounded-pill border border-border bg-card px-3.5 py-1.5 text-small font-nav text-muted-fg"
              >
                {p.label}
              </span>
            ),
          )}
          <button
            type="button"
            className="inline-flex items-center rounded-pill border border-border bg-muted px-3 py-1.5 text-small font-button text-muted-fg hover:bg-sidebar-accent"
          >
            + nuevo
          </button>
        </div>
        <p className="text-caption text-muted-fg">
          Vista global de runs · compara proyectos desde las etiquetas
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 rounded-[10px] border border-border bg-card px-3.5 py-2">
        <GitBranch className="h-4 w-4 text-muted-fg" strokeWidth={2} />
        <span className="text-small font-nav-active text-foreground">main</span>
      </div>
    </header>
  );
}
