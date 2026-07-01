import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type ProviderOption = {
  id: string;
  label: string;
  kind: "cli" | "http";
  description: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  defaultBaseUrl: string | null;
  defaultModel: string;
  supportsAutoModel: boolean;
  supportsLiveModels?: boolean;
  modelOptions: { id: string; label: string }[];
};

const CUSTOM_MODEL_ID = "__custom__";

type LlmSettingsResponse = {
  ok: true;
  settings: {
    providerId: string;
    model: string;
    baseUrl: string | null;
    apiKeyConfigured: boolean;
    apiKeyHint: string | null;
  } | null;
  status: {
    available: boolean;
    providerId: string;
    model: string;
    source: string;
    cursorCli?: {
      installed: boolean;
      loggedIn: boolean;
      message: string;
    };
  };
  envFallback: boolean;
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption font-button ${
        ok ? "bg-success/15 text-success" : "bg-error/10 text-error-fg"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

export function LlmSettingsPanel() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerId, setProviderId] = useState("cursor-cli");
  const [model, setModel] = useState("auto");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null);
  const [status, setStatus] = useState<LlmSettingsResponse["status"] | null>(null);
  const [envFallback, setEnvFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<{ id: string; label: string }[]>([]);
  const [modelsSource, setModelsSource] = useState<"live" | "fallback" | "static" | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModelId, setCustomModelId] = useState("");

  const selected = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  const modelOptions = useMemo(() => {
    if (selected?.supportsLiveModels && liveModels.length > 0) return liveModels;
    return selected?.modelOptions ?? [];
  }, [selected, liveModels]);

  const fetchLiveModels = useCallback(async (pid: string) => {
    const prov = providers.find((p) => p.id === pid);
    if (!prov?.supportsLiveModels) {
      setLiveModels([]);
      setModelsSource(null);
      return;
    }
    setModelsLoading(true);
    try {
      const res = await apiFetch(`/v1/settings/llm/models?providerId=${encodeURIComponent(pid)}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        models: { id: string; label: string }[];
        source: "live" | "fallback" | "static";
        message?: string;
      };
      setLiveModels(body.models);
      setModelsSource(body.source);
    } catch {
      setLiveModels(prov.modelOptions);
      setModelsSource("fallback");
    } finally {
      setModelsLoading(false);
    }
  }, [providers]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, settingsRes] = await Promise.all([
        apiFetch("/v1/settings/llm/providers"),
        apiFetch("/v1/settings/llm"),
      ]);
      if (provRes.ok) {
        const body = (await provRes.json()) as { providers: ProviderOption[] };
        setProviders(body.providers);
      }
      if (settingsRes.ok) {
        const body = (await settingsRes.json()) as LlmSettingsResponse;
        setStatus(body.status);
        setEnvFallback(body.envFallback);
        if (body.settings) {
          setProviderId(body.settings.providerId);
          setModel(body.settings.model);
          setBaseUrl(body.settings.baseUrl ?? "");
          setApiKeyConfigured(body.settings.apiKeyConfigured);
          setApiKeyHint(body.settings.apiKeyHint);
        } else if (body.status.providerId) {
          setProviderId(body.status.providerId);
          setModel(body.status.model);
        }
      }
    } catch {
      setError("No se pudo cargar la configuración de IA");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading || providers.length === 0) return;
    void fetchLiveModels(providerId);
  }, [loading, providers, providerId, fetchLiveModels]);

  useEffect(() => {
    if (!model || modelOptions.length === 0) return;
    const known = modelOptions.some((m) => m.id === model);
    if (!known && model !== CUSTOM_MODEL_ID) {
      setUseCustomModel(true);
      setCustomModelId(model);
    }
  }, [model, modelOptions]);

  useEffect(() => {
    if (!selected) return;
    if (!baseUrl && selected.defaultBaseUrl) setBaseUrl(selected.defaultBaseUrl);
    if (!model) setModel(selected.defaultModel);
  }, [selected, baseUrl, model]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const resolvedModel = useCustomModel ? customModelId.trim() : model;
    if (!resolvedModel) {
      setSaving(false);
      setError("Indica un modelo");
      return;
    }
    const res = await apiFetch("/v1/settings/llm", {
      method: "PUT",
      body: JSON.stringify({
        providerId,
        model: resolvedModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(selected.needsBaseUrl ? { baseUrl: baseUrl.trim() || selected.defaultBaseUrl } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(typeof body.error === "string" ? body.error : "Error al guardar");
      return;
    }
    const body = (await res.json()) as { status: LlmSettingsResponse["status"]; settings: LlmSettingsResponse["settings"] };
    setStatus(body.status);
    if (body.settings) {
      setApiKeyConfigured(body.settings.apiKeyConfigured);
      setApiKeyHint(body.settings.apiKeyHint);
      setModel(body.settings.model);
      setUseCustomModel(false);
      setCustomModelId("");
    }
    setApiKey("");
    setMessage("Configuración de IA guardada");
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    const res = await apiFetch("/v1/settings/llm/test", { method: "POST" });
    setTesting(false);
    if (!res.ok) {
      setError("No se pudo verificar el proveedor");
      return;
    }
    const body = (await res.json()) as { status: LlmSettingsResponse["status"] };
    setStatus(body.status);
    setMessage(body.status.available ? "Proveedor disponible" : "Proveedor no disponible");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-small text-muted-fg sm:px-5">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando configuración de IA…
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-0 divide-y divide-border">
      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-small text-muted-fg">
            <Sparkles className="h-4 w-4 text-primary" />
            Modo asistido (planificación con IA)
          </div>
          {status && (
            <StatusBadge
              ok={status.available}
              label={status.available ? "Listo" : "No disponible"}
            />
          )}
        </div>

        {!status?.available && envFallback && (
          <p className="rounded-ui border border-border bg-muted/50 px-3 py-2 text-caption text-muted-fg">
            Sin preferencias guardadas; el servidor usa variables de entorno (.env) como respaldo.
          </p>
        )}

        <div>
          <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-provider">
            Proveedor
          </label>
          <select
            id="llm-provider"
            value={providerId}
            onChange={(e) => {
              const next = providers.find((p) => p.id === e.target.value);
              setProviderId(e.target.value);
              if (next) {
                setModel(next.defaultModel);
                setBaseUrl(next.defaultBaseUrl ?? "");
                setApiKey("");
                setUseCustomModel(false);
                setCustomModelId("");
                setLiveModels([]);
              }
            }}
            className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground outline-none ring-primary focus:ring-2"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {selected && (
            <p className="mt-1.5 text-caption leading-snug text-muted-fg">{selected.description}</p>
          )}
        </div>

        {selected?.kind === "cli" && (
          <div className="rounded-ui border border-border bg-muted/30 px-3 py-3 space-y-2">
            <div className="text-caption font-button text-foreground">Cursor Agent CLI</div>
            {status?.cursorCli ? (
              <>
                <StatusBadge
                  ok={status.cursorCli.loggedIn}
                  label={status.cursorCli.loggedIn ? "Autenticado" : "Sin sesión"}
                />
                <p className="text-caption text-muted-fg">{status.cursorCli.message}</p>
                {!status.cursorCli.loggedIn && (
                  <p className="text-caption text-muted-fg">
                    En terminal: <code className="rounded bg-muted px-1">agent login</code>
                  </p>
                )}
              </>
            ) : (
              <p className="text-caption text-muted-fg">Guarda y prueba para verificar el CLI.</p>
            )}
          </div>
        )}

        {selected?.needsApiKey && (
          <div>
            <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-api-key">
              API key
            </label>
            <input
              id="llm-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyConfigured ? `Configurada (${apiKeyHint ?? "••••"}) — dejar vacío para mantener` : "sk-…"}
              className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg outline-none ring-primary focus:ring-2"
              autoComplete="off"
            />
          </div>
        )}

        {selected?.needsBaseUrl && (
          <div>
            <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-base-url">
              Base URL (chat completions)
            </label>
            <input
              id="llm-base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected.defaultBaseUrl ?? "https://…"}
              className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground outline-none ring-primary focus:ring-2"
            />
          </div>
        )}

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="text-caption font-button text-foreground" htmlFor="llm-model">
              Modelo
            </label>
            {selected?.supportsLiveModels && modelsSource && (
              <span className="text-caption text-muted-fg">
                {modelsLoading
                  ? "Cargando modelos…"
                  : modelsSource === "live"
                    ? `${modelOptions.length} modelos (cuenta Cursor)`
                    : "Lista reducida (CLI no respondió)"}
              </span>
            )}
          </div>
          <select
            id="llm-model"
            value={useCustomModel ? CUSTOM_MODEL_ID : model}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_MODEL_ID) {
                setUseCustomModel(true);
                if (!customModelId) setCustomModelId(model !== CUSTOM_MODEL_ID ? model : "");
              } else {
                setUseCustomModel(false);
                setModel(v);
              }
            }}
            disabled={modelsLoading && selected?.supportsLiveModels}
            className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {selected?.supportsLiveModels && (
              <option value={CUSTOM_MODEL_ID}>Personalizado…</option>
            )}
          </select>
          {useCustomModel && (
            <input
              id="llm-model-custom"
              type="text"
              value={customModelId}
              onChange={(e) => setCustomModelId(e.target.value)}
              placeholder="p. ej. composer-2.5, gpt-5.3-codex-high"
              className="mt-2 w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg outline-none ring-primary focus:ring-2"
              autoComplete="off"
            />
          )}
          {selected?.supportsLiveModels && (
            <p className="mt-1.5 text-caption text-muted-fg">
              Lista desde <code className="rounded bg-muted px-1">agent models</code>. Si Cursor añade
              modelos nuevos, aparecen aquí sin actualizar Ghostly.
            </p>
          )}
        </div>

        {message && <p className="text-caption text-success">{message}</p>}
        {error && <p className="text-caption text-error-fg">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing || saving}
          className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-muted disabled:opacity-50"
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="submit"
          disabled={saving || testing}
          className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
