import {
  ChevronsLeft,
  CirclePlay,
  LayoutDashboard,
  LogOut,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";

const navMain = [
  { label: "Overview", icon: LayoutDashboard, active: false },
  { label: "Ejecuciones", icon: CirclePlay, active: true },
  { label: "Flujos & casos", icon: Workflow, active: false },
] as const;

const navSys = [{ label: "Preferencias", icon: SlidersHorizontal, active: false }] as const;

export function Sidebar() {
  return (
    <aside className="flex h-screen min-h-screen w-[260px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between gap-2 px-6 py-6 pb-4">
        <span className="text-body font-nav-active text-sidebar-emphasis">GhostTester</span>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui border border-transparent text-sidebar-fg hover:bg-sidebar-accent"
          aria-label="Colapsar barra lateral"
        >
          <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 px-4">
        <p className="px-2 pb-1 pt-2 text-overline font-overline uppercase tracking-wide text-muted-fg">
          Navegación
        </p>
        {navMain.map(({ label, icon: Icon, active }) => (
          <a
            key={label}
            href="#"
            className={
              active
                ? "flex items-center gap-2 rounded-2xl border border-sidebar-active-border bg-sidebar-active px-3 py-2.5 text-body text-sidebar-emphasis"
                : "flex items-center gap-2 rounded-2xl px-3 py-2.5 text-body font-nav text-sidebar-fg hover:bg-sidebar-accent"
            }
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className={active ? "font-nav-active" : ""}>{label}</span>
          </a>
        ))}
        <p className="px-2 pb-1 pt-6 text-overline font-overline uppercase tracking-wide text-muted-fg">
          Sistema
        </p>
        {navSys.map(({ label, icon: Icon, active }) => (
          <a
            key={label}
            href="#"
            className={
              active
                ? "flex items-center gap-2 rounded-2xl border border-sidebar-active-border bg-sidebar-active px-3 py-2.5 text-body text-sidebar-emphasis"
                : "flex items-center gap-2 rounded-2xl px-3 py-2.5 text-body font-nav text-sidebar-fg hover:bg-sidebar-accent"
            }
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="mt-auto border-t border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-2 border-primary bg-accent text-caption font-badge text-primary"
            aria-hidden
          >
            JM
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-small font-nav-active text-sidebar-emphasis">Jonas Meza</p>
            <p className="truncate text-caption text-sidebar-fg">jonas@ghosttester.local</p>
          </div>
        </div>
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-transparent py-2 text-small font-button text-foreground hover:bg-muted"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
