import { Plus, Search } from "lucide-react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/": "Inicio",
  "/runs": "Ejecuciones",
  "/flows": "Flujos & casos",
  "/settings": "Preferencias",
};

const SUBTITLES: Record<string, string> = {
  "/":
    "Organiza proyectos",
  "/runs":
    "Lista de ejecuciones del navegador.",
  "/flows": "Define y reutiliza flujos — sección en preparación.",
  "/settings": "Cuenta y preferencias.",
};

export function Header() {
  const location = useLocation();
  const isRunsPage = location.pathname.startsWith("/runs");

  const matched = Object.entries(TITLES).find(([path]) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path),
  );
  const title = matched?.[1] ?? "Ghostly";
  const subtitleKey = matched?.[0] ?? "/";
  const subtitle = SUBTITLES[subtitleKey] ?? "";
  const breadcrumb = [title];

  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-10 py-5 backdrop-saturate-150">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2 text-small text-muted-fg">
          {breadcrumb.map((item, idx) => (
            <span key={item} className="inline-flex items-center gap-2">
              {idx > 0 && <span className="text-text-tertiary">/</span>}
              <span className={idx === breadcrumb.length - 1 ? "text-foreground font-nav-active" : ""}>{item}</span>
            </span>
          ))}
        </div>
        {subtitle && <p className="text-caption text-muted-fg">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("ghostly:open-command-palette"))}
          className="inline-flex min-w-[210px] items-center justify-between rounded-control-sm border border-border bg-bg-muted px-3 py-1.5 text-small text-muted-fg hover:border-border-strong hover:text-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" strokeWidth={1.8} />
            Buscar
          </span>
          <span className="rounded-control-sm border border-border px-1.5 py-0.5 font-mono text-micro text-muted-fg">
            Ctrl+Shift+K
          </span>
        </button>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(isRunsPage ? "ghostly:new-run" : "ghostly:new-project"),
            )
          }
          className="inline-flex items-center gap-2 rounded-control-sm bg-primary px-3 py-1.5 text-small font-button text-primary-fg hover:opacity-95"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {isRunsPage ? "Nueva ejecución" : "Nuevo proyecto"}
        </button>
      </div>
    </header>
  );
}
