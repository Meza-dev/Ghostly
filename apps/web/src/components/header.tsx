import { Plus, Search } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useLanguage } from "../context/language-context";
import type { MessageKey } from "../i18n/en";

const TITLE_KEYS: Record<string, MessageKey> = {
  "/": "nav.home",
  "/runs": "nav.runs",
  "/flows": "nav.flows",
  "/settings": "nav.settings",
};

const SUBTITLE_KEYS: Record<string, MessageKey> = {
  "/": "header.subtitle.home",
  "/runs": "header.subtitle.runs",
  "/flows": "header.subtitle.flows",
  "/settings": "header.subtitle.settings",
};

export function Header() {
  const location = useLocation();
  const { t } = useLanguage();
  const isRunsPage = location.pathname.startsWith("/runs");

  const matched = Object.entries(TITLE_KEYS).find(([path]) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path),
  );
  const title = matched ? t(matched[1]) : "Ghostly";
  const subtitleKey = matched?.[0] ?? "/";
  const subtitleMsgKey = SUBTITLE_KEYS[subtitleKey];
  const subtitle = subtitleMsgKey ? t(subtitleMsgKey) : "";
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
            {t("header.search")}
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
          {isRunsPage ? t("header.newRun") : t("header.newProject")}
        </button>
      </div>
    </header>
  );
}
