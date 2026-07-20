import {
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
import type { RunRecord } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { useAuth } from "../context/auth-context";
import { useLanguage } from "../context/language-context";
import { useTheme } from "../context/theme-context";
import { apiFetch } from "../lib/api";
import { getUserGroupMeta, getUserVerdictGroup } from "../lib/verdict";

/** Cantidad de runs recientes que muestra el sidebar (diseño: 4). */
const RECENT_RUNS_LIMIT = 4;

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
  {
    labelKey: "nav.settings",
    icon: SlidersHorizontal,
    path: "/settings",
    hintKey: "sidebar.hint.settings",
  },
] as const;

export function Sidebar() {
  const { sidebarCollapsed, projects, setActiveProjectId } = useAppContext();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [projectStats, setProjectStats] = useState<Record<string, { total: number; pass: number }>>({});
  const [recentRuns, setRecentRuns] = useState<RunRecord[]>([]);
  const projectLabelById = new Map(projects.map((p) => [p.id, p.label] as const));

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const w = sidebarCollapsed ? "w-[72px]" : "w-64";

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
        const runs = (await res.json()) as RunRecord[];
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
        // La API ya devuelve las runs de la más nueva a la más vieja.
        setRecentRuns(runs.slice(0, RECENT_RUNS_LIMIT));
      } catch {
        if (!cancelled) {
          setProjectStats({});
          setRecentRuns([]);
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
        className={`flex items-center gap-2 py-5 ${sidebarCollapsed ? "justify-center px-3" : "justify-between px-6"}`}
      >
        {!sidebarCollapsed && (
          <span className="inline-flex items-center gap-3 text-lg font-title tracking-[-0.01em] text-sidebar-emphasis">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-pill bg-foreground text-bg-main">
              <span className="absolute inset-[-4px] rounded-pill bg-brand-primary-soft" />
              <Ghost className="relative z-10 h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            Ghostly
          </span>
        )}
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

      <nav
        className={`ghostly-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto ${sidebarCollapsed ? "px-2" : "px-4"}`}
      >
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
                  ? `flex items-center gap-2.5 rounded-control-sm border-l-[3px] border-l-sidebar-active-border bg-brand-primary-soft px-2.5 py-2 text-body font-nav-active text-sidebar-emphasis ${sidebarCollapsed ? "justify-center border-l-0" : ""}`
                  : `flex items-center gap-2.5 rounded-control-sm px-2.5 py-2 text-body font-nav text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis ${sidebarCollapsed ? "justify-center" : ""}`
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          );
        })}

        {!sidebarCollapsed && projects.length > 0 && (
          <>
            <p className="px-2 pb-1.5 pt-6 text-overline font-overline uppercase tracking-wider text-text-tertiary">
              {t("sidebar.projects")}
            </p>
            {projects.slice(0, 5).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => openProject(p.id)}
                className="flex items-center gap-2.5 rounded-control-sm px-2.5 py-2 text-body text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-primary" />
                <span className="truncate">{p.label}</span>
                <span className="ml-auto font-mono text-small text-text-tertiary">
                  {projectStats[p.id]?.pass ?? 0}/{projectStats[p.id]?.total ?? 0}
                </span>
              </button>
            ))}
          </>
        )}

        {!sidebarCollapsed && (
          <>
            <p className="px-2 pb-1 pt-5 text-overline font-overline uppercase tracking-wider text-text-tertiary">
              {t("sidebar.activity")}
            </p>
            {recentRuns.length === 0 ? (
              <p className="px-2.5 py-1 text-caption text-text-tertiary">{t("sidebar.noActivity")}</p>
            ) : (
              recentRuns.map((run) => {
                const running = run.status === "running";
                const gm = getUserGroupMeta(getUserVerdictGroup(run.verdict, run.status));
                const goal =
                  run.assisted?.goal?.trim() || t("runs.goal.flowRun", { count: run.steps.length });
                const project = run.project
                  ? projectLabelById.get(run.project) ?? run.project
                  : t("runs.noProject");
                const state = running ? t("runs.status.running") : t(gm.labelKey);
                // Atajo secundario: una línea por run. El punto ya comunica el estado,
                // así que proyecto y veredicto viven en el tooltip y no gastan alto.
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => navigate(`/runs/${run.id}`)}
                    title={`${goal} — ${project} · ${state}`}
                    className="flex items-center gap-2 rounded-control-sm px-2.5 py-1 text-left text-sidebar-fg hover:bg-sidebar-accent hover:text-sidebar-emphasis"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-pill ${running ? "bg-primary animate-pulse" : gm.dot}`}
                    />
                    <span className="truncate text-caption">{goal}</span>
                  </button>
                );
              })
            )}
          </>
        )}
      </nav>

      <div className={`border-t border-bg-muted py-4 ${sidebarCollapsed ? "px-2" : "px-6"}`}>
        {user && !sidebarCollapsed && (
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-small font-badge text-bg-main"
              aria-hidden
            >
              {initialsFromEmail(user.email)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-nav-active text-sidebar-emphasis">{user.email}</p>
              <p className="truncate text-small capitalize text-text-tertiary">{user.role}</p>
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
