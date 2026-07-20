import { ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "../context/language-context";
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

export function LlmSettingsPanel() {
  const { t } = useLanguage();
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveModels, setLiveModels] = useState<{ id: string; label: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModelId, setCustomModelId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    } catch {
      setLiveModels(prov.modelOptions);
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
      setError(t("llm.error.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
    if (!known) {
      // Modelo guardado que no está en la lista → es custom: mostralo en Avanzado.
      setCustomModelId(model);
      setAdvancedOpen(true);
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
    // El modelo custom (Avanzado) tiene prioridad sobre la selección del dropdown.
    const resolvedModel = customModelId.trim() || model;
    if (!resolvedModel) {
      setSaving(false);
      setError(t("llm.error.noModel"));
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
    if (!res.ok) {
      setSaving(false);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(typeof body.error === "string" ? body.error : t("llm.error.save"));
      return;
    }
    const body = (await res.json()) as { status: LlmSettingsResponse["status"]; settings: LlmSettingsResponse["settings"] };
    setStatus(body.status);
    if (body.settings) {
      setApiKeyConfigured(body.settings.apiKeyConfigured);
      setApiKeyHint(body.settings.apiKeyHint);
      setModel(body.settings.model);
      setCustomModelId("");
    }
    setApiKey("");
    // "Guardar que prueba solo": tras guardar, verificamos y mostramos el estado.
    try {
      const testRes = await apiFetch("/v1/settings/llm/test", { method: "POST" });
      if (testRes.ok) {
        const tb = (await testRes.json()) as { status: LlmSettingsResponse["status"] };
        setStatus(tb.status);
        setMessage(tb.status.available ? t("llm.status.available") : t("llm.status.unavailable"));
      } else {
        setMessage(t("llm.msg.saved"));
      }
    } catch {
      setMessage(t("llm.msg.saved"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-small text-muted-fg sm:px-5">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("llm.loading")}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-0 divide-y divide-border">
      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-small text-muted-fg">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("llm.assistedMode")}
          </div>
        </div>

        {!status?.available && envFallback && (
          <p className="rounded-ui border border-border bg-muted/50 px-3 py-2 text-caption text-muted-fg">
            {t("llm.envFallback")}
          </p>
        )}

        <div>
          <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-provider">
            {t("llm.field.provider")}
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
        </div>

        {selected?.kind === "cli" && (
          <div className="rounded-ui border border-border bg-muted/30 px-3 py-3 space-y-2">
            <div className="text-caption font-button text-foreground">Cursor Agent CLI</div>
            {status?.cursorCli ? (
              <>
                <p className="text-caption text-muted-fg">{status.cursorCli.message}</p>
                {!status.cursorCli.loggedIn && (
                  <p className="text-caption text-muted-fg">
                    {t("llm.cursor.inTerminal")} <code className="rounded bg-muted px-1">agent login</code>
                  </p>
                )}
              </>
            ) : (
              <p className="text-caption text-muted-fg">{t("llm.cursor.savePrompt")}</p>
            )}
          </div>
        )}

        {selected?.needsApiKey && (
          <div>
            <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-api-key">
              {t("llm.field.apiKey")}
            </label>
            <input
              id="llm-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={apiKeyConfigured ? t("llm.apiKey.placeholderConfigured", { hint: apiKeyHint ?? "••••" }) : "sk-…"}
              className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg outline-none ring-primary focus:ring-2"
              autoComplete="off"
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-model">
            {t("llm.field.model")}
          </label>
          <select
            id="llm-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setCustomModelId("");
            }}
            disabled={modelsLoading && selected?.supportsLiveModels}
            className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground outline-none ring-primary focus:ring-2 disabled:opacity-60"
          >
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Avanzado: endpoint propio y modelo custom, plegados para el caso común. */}
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-expanded={advancedOpen}
            className="flex items-center gap-1.5 text-caption font-button text-muted-fg hover:text-foreground"
          >
            {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t("llm.advanced")}
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-4 rounded-ui border border-border bg-muted/30 px-3 py-3">
              {selected?.needsBaseUrl && (
                <div>
                  <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-base-url">
                    {t("llm.field.baseUrl")}
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
                <label className="mb-1.5 block text-caption font-button text-foreground" htmlFor="llm-model-custom">
                  {t("llm.models.custom")}
                </label>
                <input
                  id="llm-model-custom"
                  type="text"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder={t("llm.models.customPlaceholder")}
                  className="w-full rounded-control-lg border border-border bg-background px-3 py-2 text-small text-foreground placeholder:text-muted-fg outline-none ring-primary focus:ring-2"
                  autoComplete="off"
                />
                {selected?.supportsLiveModels && (
                  <p className="mt-1.5 text-caption text-muted-fg">
                    {t("llm.models.helpBefore")} <code className="rounded bg-muted px-1">agent models</code>{t("llm.models.helpAfter")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {message && <p className="text-caption text-success">{message}</p>}
        {error && <p className="text-caption text-error-fg">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-5">
        <button
          type="submit"
          disabled={saving}
          className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
        >
          {saving ? t("llm.btn.saving") : t("llm.btn.save")}
        </button>
      </div>
    </form>
  );
}
