import { Copy, Key, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LlmSettingsPanel } from "../components/llm-settings-panel";
import { useLanguage, type Lang } from "../context/language-context";
import { useTheme, type Theme } from "../context/theme-context";
import { apiFetch } from "../lib/api";

type ApiKeyRecord = {
  id: string;
  label: string;
  key: string;
  createdAt: string;
};

const PREFS_STORAGE_KEY = "ghostly-ui-prefs";

type UiPrefs = {
  gitWatch: boolean;
  heal: boolean;
  video: boolean;
  slack: boolean;
  workspaceName: string;
};

const defaultUiPrefs: UiPrefs = {
  gitWatch: true,
  heal: true,
  video: true,
  slack: false,
  workspaceName: "acme",
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

function SettingsSection({
  title,
  desc,
  children,
  bare,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  bare?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-surface border border-border bg-card shadow-surface">
      <header className="border-b border-border bg-muted/50 px-4 py-3 sm:px-5">
        <h2 className="text-body font-nav-active text-foreground">{title}</h2>
        <p className="mt-0.5 text-caption text-muted-fg">{desc}</p>
      </header>
      {bare ? children : <div className="divide-y divide-border">{children}</div>}
    </section>
  );
}

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
    <div className="flex items-center justify-between gap-4 px-4 py-3 sm:gap-6 sm:px-5 sm:py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-small font-nav-active text-foreground">{title}</div>
        <div className="mt-0.5 text-caption leading-snug text-muted-fg">{desc}</div>
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
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function loadKeys() {
    const res = await apiFetch("/v1/api-keys");
    if (res.ok) setKeys((await res.json()) as ApiKeyRecord[]);
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    const res = await apiFetch("/v1/api-keys", {
      method: "POST",
      body: JSON.stringify({ label: label.trim() }),
    });
    setCreating(false);
    if (!res.ok) return;
    const data = (await res.json()) as ApiKeyRecord;
    setNewKey(data.key);
    setLabel("");
    void loadKeys();
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Revocar esta API Key?")) return;
    await apiFetch(`/v1/api-keys/${id}`, { method: "DELETE" });
    void loadKeys();
  }

  function copyKey(k: string) {
    void navigator.clipboard.writeText(k).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function setMode(m: Theme) {
    setTheme(m);
  }

  function setLangMode(l: Lang) {
    setLang(l);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-6 overflow-auto pb-4">
      <div className="border-b border-border pb-4">
        <h1 className="text-title font-title tracking-tight text-foreground">Preferencias</h1>
        <p className="mt-1 text-small text-muted-fg">Workspace, comportamiento del runner e integraciones.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-6">
          <SettingsSection title="Apariencia" desc="Cómo se ve Ghostly para ti.">
            <SettingsRow title="Tema" desc="Cambia entre claro y oscuro.">
              <div className="flex gap-1 rounded-control-md border border-border bg-muted/80 p-0.5">
                {(["light", "dark"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-control-sm px-3 py-1 text-caption font-button transition-colors ${
                      theme === m
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-fg hover:text-foreground"
                    }`}
                  >
                    {m === "light" ? "Claro" : "Oscuro"}
                  </button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow title={t("settings.language.title")} desc={t("settings.language.desc")}>
              <div className="flex gap-1 rounded-control-md border border-border bg-muted/80 p-0.5">
                {(["en", "es"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLangMode(l)}
                    className={`rounded-control-sm px-3 py-1 text-caption font-button uppercase transition-colors ${
                      lang === l
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-fg hover:text-foreground"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Runner" desc="Cómo se comporta el fantasma cuando ejecuta.">
            <SettingsRow title="Git auto-watch" desc="Disparar ejecuciones cuando se detectan commits en repos vinculados.">
              <PrefToggle on={prefs.gitWatch} onChange={(v) => patchPrefs({ gitWatch: v })} />
            </SettingsRow>
            <SettingsRow title="Self-heal de selectores" desc="Adapta selectores rotos al ejecutar (recomendado).">
              <PrefToggle on={prefs.heal} onChange={(v) => patchPrefs({ heal: v })} />
            </SettingsRow>
            <SettingsRow title="Grabar video" desc="Guarda un .webm de cada ejecución para diagnóstico.">
              <PrefToggle on={prefs.video} onChange={(v) => patchPrefs({ video: v })} />
            </SettingsRow>
          </SettingsSection>
        </div>

        <div className="flex min-h-0 flex-col gap-6">
          <SettingsSection
            title="Modo asistido (IA)"
            desc="Proveedor para planificar flujos asistidos (estilo Open Design BYOK)."
            bare
          >
            <LlmSettingsPanel />
          </SettingsSection>

          <SettingsSection title="Integraciones" desc="Servicios externos.">
            <SettingsRow title="MCP servers" desc="Servidores MCP disponibles para esta workspace.">
              <span className="font-mono text-caption text-muted-fg">3 conectados</span>
            </SettingsRow>
            <SettingsRow title="Notificaciones Slack" desc="Avisar al canal #qa-alerts cuando una ejecución falla.">
              <PrefToggle on={prefs.slack} onChange={(v) => patchPrefs({ slack: v })} />
            </SettingsRow>
            <SettingsRow title="GitHub" desc="Conectado a luna-acme · 3 repos vinculados.">
              <button
                type="button"
                className="rounded-control-sm border border-border bg-muted px-2.5 py-1 text-caption text-muted-fg transition-colors hover:border-border-strong hover:text-foreground"
              >
                Reconfigurar
              </button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="Workspace" desc="Detalles de la cuenta.">
            <SettingsRow title="Nombre" desc="Aparece en el panel y en notificaciones.">
              <input
                value={prefs.workspaceName}
                onChange={(e) => patchPrefs({ workspaceName: e.target.value })}
                className="min-w-[10rem] max-w-full rounded-control-sm border border-border-strong bg-background px-2.5 py-1.5 text-small text-foreground outline-none ring-primary focus:ring-2 sm:w-44"
                aria-label="Nombre del workspace"
              />
            </SettingsRow>
            <SettingsRow title="Plan" desc="Equipo · 8 puestos activos.">
              <span className="text-small text-muted-fg">Team</span>
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>

      <section className="flex flex-col gap-4 overflow-hidden rounded-surface border border-border bg-card shadow-surface">
        <header className="border-b border-border bg-muted/50 px-4 py-3 sm:px-5">
          <h2 className="text-body font-nav-active text-foreground">API Keys</h2>
          <p className="mt-0.5 text-caption text-muted-fg">
            Para scripts, CI o el paquete{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">@ghostly-io/client</code>: crea una key y
            envíala en el header <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">X-Api-Key</code>.
          </p>
        </header>

        <div className="flex flex-col gap-4 px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        {newKey && (
          <div className="flex items-center gap-3 rounded-ui border border-success/40 bg-success/10 px-4 py-3">
            <Key className="h-4 w-4 shrink-0 text-success" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-button text-success">Copia esta key ahora, no se mostrará de nuevo</p>
              <p className="mt-1 break-all font-mono text-caption text-foreground">{newKey}</p>
            </div>
            <button
              type="button"
              onClick={() => copyKey(newKey)}
              className="shrink-0 rounded border border-border p-1.5 text-muted-fg hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {copied && <span className="text-caption text-success">Copiado</span>}
          </div>
        )}

        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            placeholder="Nombre de la key (ej. CI pipeline)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={creating || !label.trim()}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {creating ? "Creando…" : "Crear"}
          </button>
        </form>

        {keys.length === 0 ? (
          <p className="text-small text-muted-fg">No tienes API Keys aún.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-ui border border-border bg-card">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-5 py-3">
                <Key className="h-4 w-4 shrink-0 text-muted-fg" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-small font-button text-foreground">{k.label}</p>
                  <p className="font-mono text-caption text-muted-fg">{k.key}</p>
                </div>
                <span className="shrink-0 text-caption text-muted-fg">
                  {new Date(k.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(k.id)}
                  className="shrink-0 rounded p-1 text-muted-fg hover:text-error-fg"
                  aria-label="Revocar"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
        </div>
      </section>
    </div>
  );
}
