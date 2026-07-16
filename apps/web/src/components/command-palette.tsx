import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/app-context";
import { useLanguage } from "../context/language-context";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

type CmdItem = {
  id: string;
  label: string;
  type?: "page" | "project" | "action";
  keywords?: string;
  action: () => void;
};

export function CommandPalette() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { projects, setActiveProjectId } = useAppContext();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setQuery("");
      setSelected(0);
    }
    wasOpen.current = open;
  }, [open]);

  const items = useMemo<CmdItem[]>(() => {
    const list: CmdItem[] = [
      {
        id: "inicio",
        label: t("nav.home"),
        type: "page",
        keywords: "home dashboard proyectos",
        action: () => navigate("/"),
      },
      {
        id: "runs",
        label: t("nav.runs"),
        type: "page",
        keywords: "ejecuciones runs historial",
        action: () => navigate("/runs"),
      },
      {
        id: "flows",
        label: t("nav.flows"),
        type: "page",
        keywords: "flows tests grupos",
        action: () => navigate("/flows"),
      },
      {
        id: "settings",
        label: t("nav.settings"),
        type: "page",
        keywords: "settings cuenta api keys",
        action: () => navigate("/settings"),
      },
    ];

    if (pathname === "/runs") {
      list.push({
        id: "new-run",
        label: t("palette.newRun"),
        type: "action",
        keywords: "modal crear ejecutar",
        action: () => {
          window.dispatchEvent(new CustomEvent("ghostly:new-run"));
        },
      });
    } else if (pathname.startsWith("/runs/")) {
      list.push({
        id: "new-run",
        label: t("palette.newRun"),
        type: "action",
        keywords: "modal crear ejecutar",
        action: () => {
          navigate("/runs", { state: { openNewRun: true } });
        },
      });
    } else {
      list.push({
        id: "new-project",
        label: t("palette.newProject"),
        type: "action",
        keywords: "crear workspace",
        action: () => {
          window.dispatchEvent(new CustomEvent("ghostly:new-project"));
        },
      });
    }

    if (projects.length > 0) {
      for (const project of projects) {
        list.push({
          id: `project-${project.id}`,
          label: project.label,
          type: "project",
          keywords: `proyecto ${project.id} runs ejecuciones`,
          action: () => {
            setActiveProjectId(project.id);
            navigate("/runs");
          },
        });
      }
    }

    return list;
  }, [navigate, pathname, projects, setActiveProjectId, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  useEffect(() => {
    setSelected((s) => (filtered.length === 0 ? 0 : Math.min(s, filtered.length - 1)));
  }, [filtered]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const runItem = useCallback(
    (it: CmdItem) => {
      close();
      it.action();
    },
    [close],
  );

  useEffect(() => {
    const onPaletteOpen = () => setOpen(true);
    window.addEventListener("ghostly:open-command-palette", onPaletteOpen);
    return () => window.removeEventListener("ghostly:open-command-palette", onPaletteOpen);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const shiftMod = mod && e.shiftKey;
      if (shiftMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      if (openRef.current && shiftMod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        return;
      }

      if (shiftMod && (e.key === "n" || e.key === "N")) {
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        if (pathname === "/runs") {
          window.dispatchEvent(new CustomEvent("ghostly:new-run"));
        } else if (pathname.startsWith("/runs/")) {
          navigate("/runs", { state: { openNewRun: true } });
        } else {
          window.dispatchEvent(new CustomEvent("ghostly:new-project"));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(0, filtered.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        runItem(filtered[selected]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, filtered, selected, runItem]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.aria.dialog")}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label={t("palette.aria.close")}
        onClick={close}
      />
      <div className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-panel border border-border bg-card shadow-overlay">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-fg" strokeWidth={2} />
          <input
            ref={inputRef}
            type="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("palette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-small text-foreground outline-none placeholder:text-muted-fg"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-fg sm:inline">
            Esc
          </kbd>
        </div>
        <ul className="max-h-[min(50vh,320px)] overflow-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-caption text-muted-fg">{t("palette.noResults")}</li>
          ) : (
            filtered.map((it, idx) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => runItem(it)}
                  onMouseEnter={() => setSelected(idx)}
                  className={`flex w-full items-center px-4 py-2.5 text-left text-small transition-colors ${
                    idx === selected ? "bg-muted text-foreground" : "text-muted-fg hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{it.label}</span>
                  <span className="ml-auto pl-3 font-mono text-micro uppercase tracking-wide text-muted-fg">
                    {it.type === "project" ? t("palette.type.project") : it.type === "action" ? t("palette.type.action") : t("palette.type.page")}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-border px-4 py-2 text-micro text-muted-fg">
          <span className="font-mono">Ctrl+Shift+N</span> {t("palette.footer.quickAction")} · <span className="font-mono">↑↓</span> {t("palette.footer.navigate")} ·{" "}
          <span className="font-mono">Enter</span> {t("palette.footer.run")}
        </div>
      </div>
    </div>
  );
}
