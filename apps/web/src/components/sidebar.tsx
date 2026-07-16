import {
  Activity,
  CirclePlay,
  Ghost,
  LayoutDashboard,
  LogOut,
  Moon,
  SlidersHorizontal,
  Sun,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppContext } from "../context/app-context";
import { useAuth } from "../context/auth-context";
import { useLanguage } from "../context/language-context";
import { useTheme } from "../context/theme-context";
import { apiFetch } from "../lib/api";
import { LanguageToggle } from "./language-toggle";

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (local.slice(0, 2) || "??").toUpperCase();
}

const navMain = [
  {
    labelKey: "nav.home",
    icon: LayoutDashboard,
    path: "/",
    hintKey: "sidebar.hint.home",
  },
  {
    labelKey: "nav.runs",
    icon: CirclePlay,
    path: "/runs",
    hintKey: "sidebar.hint.runs",
  },
  {
    labelKey: "nav.flows",
    icon: Workflow,
    path: "/flows",
    hintKey: "sidebar.hint.flows",
  },
] as const;

const navSys = [
  { labelKey: "nav.settings", icon: SlidersHorizontal, path: "/settings" },
] as const;

export function Sidebar() {
  const { sidebarCollapsed, projects, setActiveProjectId } = useAppContext();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [projectStats, setProjectStats] = useState<Record<string, { total: number; pass: number }>>({});

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const w = sidebarCollapsed ? "w-[72px]" : "w-[248px]";

  function openProject(id: string) {
    setActiveProjectId(id);
    navigate("/runs");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/v1/runs");
        if (!res.ok) return;
        const runs = (await res.json()) as Array<{ id: string; status: string; project?: string }>;
        if (cancelled) return;
        const stats: Record<string, { total: number; pass: number }> = {};
        for (const run of runs) {
          const key = run.project ?? "";
          if (!key) continue;
          if (!stats[key]) stats[key] = { total: 0, pass: 0 };
          stats[key]!.total += 1;
          if (run.status === "pass") stats[key]!.pass += 1;
        }
        setProjectStats(stats);
      } catch {
        if (!cancelled) {
          setProjectStats({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col self-stretch bg-bg-subtle transition-all duration-200 ${w}`}
    >
      <div
        className={`flex items-center gap-2 py-5 ${sidebarCollapsed ? "justify-center px-3" : "justify-between pl-6 pr-4"}`}
      >
        {!sidebarCollapsed && (
          <span className="inline-flex items-center gap-3 text-lg font-title tracking-[-0.01em] text-sidebar-emphasis">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-pill bg-foreground text-bg-main">
              <span className="absolute inset-[-4px] rounded-pill bg-brand-primary-soft" />
              <Ghost className="relative z-10 h-4.5 w-4.5" strokeWidth={2} />
            </span>
            Ghostly
          </span>
        )}
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control-sm text-sidebar-fg transition-colors hover:bg-sidebar-accent hover:text-sidebar-emphasis"
            aria-label={theme === "dark" ? t("sidebar.theme.toLight.aria") : t("sidebar.theme.toDark.aria")}
            title={theme === "dark" ? t("sidebar.theme.light") : t("sidebar.theme.dark")}
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </div>

      <nav className={`flex min-h-0 flex-1 flex-col gap-1 ${sidebarCollapsed ? "px-2" : "pl-6 pr-4"}`}>
        {navMain.map(({ labelKey, icon: Icon, path, hintKey }) => {
          const active = location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
          const label = t(labelKey);
          const hint = t(hintKey);
          return (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              title={sidebarCollapsed ? `${label} — ${hint}` : hint}
              className={
                active
                  ? `flex items-center gap-2 rounded-control-sm border-l-[3px] border-l-sidebar-active-border bg-brand-primary-soft px-2.5 py-1.5 text-[13px] font-nav-active text-sidebar-emphasis ${sidebarCollapsed ? "justify-center border-l-0" : ""}`
                  : `flex items-center gap-2 rounded-control-sm px-2.5 py-1.5 text-[13px] font-nav text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis ${sidebarCollapsed ? "justify-center" : ""}`
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              {!sidebarCollapsed && (
                <span className={active ? "font-nav-active" : ""}>{label}</span>
              )}
            </button>
          );
        })}

        {sidebarCollapsed && <div className="my-2 border-t border-border" />}
        {navSys.map(({ labelKey, icon: Icon, path }) => {
          const active = location.pathname === path;
          const label = t(labelKey);
          return (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              title={sidebarCollapsed ? label : undefined}
              className={
                active
                  ? `flex items-center gap-2 rounded-control-sm border-l-[3px] border-l-sidebar-active-border bg-brand-primary-soft px-2.5 py-1.5 text-[13px] font-nav-active text-sidebar-emphasis ${sidebarCollapsed ? "justify-center border-l-0" : ""}`
                  : `flex items-center gap-2 rounded-control-sm px-2.5 py-1.5 text-[13px] font-nav text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis ${sidebarCollapsed ? "justify-center" : ""}`
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          );
        })}

        {!sidebarCollapsed && projects.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-6 text-overline font-overline uppercase tracking-wide text-muted-fg">
              {t("sidebar.projects")}
            </p>
            {projects.slice(0, 5).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openProject(p.id)}
                className="flex items-center gap-2 rounded-control-sm px-2.5 py-1.5 text-[13px] text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis"
              >
                <span className="h-1.5 w-1.5 rounded-pill bg-primary" />
                <span className="truncate">{p.label}</span>
                <span className="ml-auto font-mono text-caption text-muted-fg">
                  {projectStats[p.id]?.pass ?? 0}/{projectStats[p.id]?.total ?? 0}
                </span>
              </button>
            ))}
            <div className="mt-3 rounded-surface border border-border bg-sidebar-accent p-2.5">
              <div className="mb-2 inline-flex items-center gap-2 text-micro uppercase tracking-wide text-muted-fg">
                <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t("sidebar.activity")}
              </div>
              {projects.length === 0 ? (
                <p className="font-mono text-caption text-sidebar-fg">{t("sidebar.noProjects")}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {projects.slice(0, 5).map((project) => (
                    <div key={project.id} className="flex items-center gap-2 font-mono text-caption text-sidebar-fg">
                      <span className="h-1.5 w-1.5 rounded-pill bg-primary" />
                      <span className="truncate">{project.label}</span>
                      <span className="ml-auto text-muted-fg">
                        {projectStats[project.id]?.pass ?? 0}/{projectStats[project.id]?.total ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </nav>

      <div className="h-12 shrink-0" aria-hidden />

      <div className={`py-4 ${sidebarCollapsed ? "px-2" : "pl-6 pr-4"}`}>
        {user && !sidebarCollapsed && (
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-caption font-badge text-bg-main"
              aria-hidden
            >
              {initialsFromEmail(user.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-small font-nav-active text-sidebar-emphasis">{user.email}</p>
              <p className="truncate text-caption capitalize text-sidebar-fg">{user.role}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title={t("sidebar.logout")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-sm border border-border bg-transparent text-foreground hover:bg-muted"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          </div>
        )}
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={handleLogout}
            title={t("sidebar.logout")}
            className="mt-2 flex w-full items-center justify-center rounded-control-sm border border-border bg-transparent py-2 text-foreground hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.7} />
          </button>
        )}
      </div>
    </aside>
  );
}
