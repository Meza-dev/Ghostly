import {
  ChevronsLeft,
  ChevronsRight,
  CirclePlay,
  LayoutDashboard,
  LogOut,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppContext } from "../context/app-context";
import { useAuth } from "../context/auth-context";

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (local.slice(0, 2) || "??").toUpperCase();
}

const navMain = [
  { label: "Overview", icon: LayoutDashboard, path: "/" },
  { label: "Ejecuciones", icon: CirclePlay, path: "/runs" },
  { label: "Flujos & casos", icon: Workflow, path: "/flows" },
] as const;

const navSys = [
  { label: "Preferencias", icon: SlidersHorizontal, path: "/settings" },
] as const;

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppContext();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const w = sidebarCollapsed ? "w-[64px]" : "w-[260px]";

  return (
    <aside
      className={`flex h-screen min-h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-all duration-200 ${w}`}
    >
      <div className={`flex items-center justify-between gap-2 px-4 py-6 pb-4 ${sidebarCollapsed ? "px-2" : "px-6"}`}>
        {!sidebarCollapsed && (
          <span className="text-body font-nav-active text-sidebar-emphasis">GhostTester</span>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui border border-transparent text-sidebar-fg hover:bg-sidebar-accent"
          aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
        >
          {sidebarCollapsed ? (
            <ChevronsRight className="h-4 w-4" strokeWidth={2} />
          ) : (
            <ChevronsLeft className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </div>

      <nav className={`flex min-h-0 flex-1 flex-col gap-1 ${sidebarCollapsed ? "px-1" : "px-4"}`}>
        {!sidebarCollapsed && (
          <p className="px-2 pb-1 pt-2 text-overline font-overline uppercase tracking-wide text-muted-fg">
            Navegación
          </p>
        )}
        {navMain.map(({ label, icon: Icon, path }) => {
          const active = location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              title={sidebarCollapsed ? label : undefined}
              className={
                active
                  ? `flex items-center gap-2 rounded-2xl border border-sidebar-active-border bg-sidebar-active px-3 py-2.5 text-body text-sidebar-emphasis ${sidebarCollapsed ? "justify-center" : ""}`
                  : `flex items-center gap-2 rounded-2xl px-3 py-2.5 text-body font-nav text-sidebar-fg hover:bg-sidebar-accent ${sidebarCollapsed ? "justify-center" : ""}`
              }
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              {!sidebarCollapsed && (
                <span className={active ? "font-nav-active" : ""}>{label}</span>
              )}
            </button>
          );
        })}

        {!sidebarCollapsed && (
          <p className="px-2 pb-1 pt-6 text-overline font-overline uppercase tracking-wide text-muted-fg">
            Sistema
          </p>
        )}
        {sidebarCollapsed && <div className="my-2 border-t border-border" />}
        {navSys.map(({ label, icon: Icon, path }) => {
          const active = location.pathname === path;
          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              title={sidebarCollapsed ? label : undefined}
              className={
                active
                  ? `flex items-center gap-2 rounded-2xl border border-sidebar-active-border bg-sidebar-active px-3 py-2.5 text-body text-sidebar-emphasis ${sidebarCollapsed ? "justify-center" : ""}`
                  : `flex items-center gap-2 rounded-2xl px-3 py-2.5 text-body font-nav text-sidebar-fg hover:bg-sidebar-accent ${sidebarCollapsed ? "justify-center" : ""}`
              }
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          );
        })}
      </nav>

      <div className={`mt-auto border-t border-border py-4 ${sidebarCollapsed ? "px-2" : "px-5"}`}>
        {user && !sidebarCollapsed && (
          <div className="mb-3 flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border-2 border-primary bg-accent text-caption font-badge text-primary"
              aria-hidden
            >
              {initialsFromEmail(user.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-small font-nav-active text-sidebar-emphasis">{user.email}</p>
              <p className="truncate text-caption capitalize text-sidebar-fg">{user.role}</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          title={sidebarCollapsed ? "Cerrar sesión" : undefined}
          className={`flex w-full items-center justify-center gap-2 rounded-pill border border-border bg-transparent py-2 text-small font-button text-foreground hover:bg-muted ${sidebarCollapsed ? "px-2" : ""}`}
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
          {!sidebarCollapsed && "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}
