import { useCallback, useEffect, useState } from "react";
import { LlmSettingsPanel } from "../components/llm-settings-panel";
import { useLanguage, type Lang } from "../context/language-context";
import { useTheme, type Theme } from "../context/theme-context";

const PREFS_STORAGE_KEY = "ghostly-ui-prefs";

type UiPrefs = {
  video: boolean;
};

const defaultUiPrefs: UiPrefs = {
  video: true,
};

function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaultUiPrefs;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return { ...defaultUiPrefs, ...parsed };
  } catch {
    return defaultUiPrefs;
  }
}

function saveUiPrefs(prefs: UiPrefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** Etiqueta overline morada del diseño; las filas traen su propia línea superior. */
function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <p className="mb-1 text-overline font-overline uppercase tracking-[0.08em] text-primary">{label}</p>
      <div>{children}</div>
    </section>
  );
}

/** Fila plana separada por línea superior (diseño). */
function SettingsRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-bg-muted py-4">
      <div className="min-w-0">
        <div className="text-md font-nav-active text-foreground">{title}</div>
        <div className="mt-0.5 text-small leading-snug text-muted-fg">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Thumb siempre claro para contraste sobre pista y sobre primary; pista usa tokens del tema. */
function PrefToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-pill transition-colors ring-1 ring-inset ${
        on ? "bg-primary ring-transparent" : "bg-muted ring-border/70"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-pill bg-white shadow-md ring-1 ring-black/10 transition-transform duration-150 ease-out ${
          on ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const [prefs, setPrefs] = useState<UiPrefs>(defaultUiPrefs);

  useEffect(() => {
    setPrefs(loadUiPrefs());
  }, []);

  const patchPrefs = useCallback((partial: Partial<UiPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      saveUiPrefs(next);
      return next;
    });
  }, []);

  function setMode(m: Theme) {
    setTheme(m);
  }

  function setLangMode(l: Lang) {
    setLang(l);
  }

  return (
    <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-auto pb-12 pt-2">
      <div className="grid gap-x-10 gap-y-0 lg:grid-cols-2">
      <div>
      <SettingsSection label={t("settings.appearance.title")}>
        <SettingsRow title={t("settings.theme.title")} desc={t("settings.theme.desc")}>
          <div className="flex gap-1 rounded-control-md border border-border bg-bg-subtle p-0.5">
            {(["light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-control-sm px-3.5 py-1 text-caption font-button transition-colors ${
                  theme === m ? "bg-bg-muted text-foreground" : "text-muted-fg hover:text-foreground"
                }`}
              >
                {m === "light" ? t("settings.theme.light") : t("settings.theme.dark")}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow title={t("settings.language.title")} desc={t("settings.language.desc")}>
          <div className="flex gap-1 rounded-control-md border border-border bg-bg-subtle p-0.5">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLangMode(l)}
                className={`rounded-control-sm px-3.5 py-1 text-caption font-button uppercase transition-colors ${
                  lang === l ? "bg-bg-muted text-foreground" : "text-muted-fg hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label={t("settings.runner.title")}>
        <SettingsRow title={t("settings.runner.video.title")} desc={t("settings.runner.video.desc")}>
          <PrefToggle on={prefs.video} onChange={(v) => patchPrefs({ video: v })} />
        </SettingsRow>
      </SettingsSection>
      </div>

      <div>
      <SettingsSection label={t("settings.assist.title")}>
        <div className="border-t border-bg-muted pt-4">
          <LlmSettingsPanel />
        </div>
      </SettingsSection>
      </div>
      </div>
    </div>
  );
}
