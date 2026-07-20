import { AlertCircle, Check, ChevronDown, ChevronUp, Circle, Loader2, Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AssistedMeta, RunRecord, Step } from "../../../../packages/runner/src/schema.js";
import { useAppContext } from "../context/app-context";
import { useLanguage } from "../context/language-context";
import type { MessageKey } from "../i18n/en";
import { apiFetch } from "../lib/api";
import { loadUiPrefs } from "../lib/ui-prefs";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Conserva la URL de inicio (incluyendo path) como `baseUrl`. */
function parseStartUrl(raw: string, t: TFn): { ok: true; baseUrl: string; gotoPath: string } | { ok: false; message: string } {
  const s = raw.trim();
  if (!s) return { ok: false, message: t("newRun.error.startUrlRequired") };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { ok: false, message: t("newRun.error.startUrlInvalid") };
  }
  if (!u.hostname) return { ok: false, message: t("newRun.error.startUrlInvalid") };
  const baseUrl = `${u.origin}${u.pathname && u.pathname !== "" ? u.pathname : "/"}`;
  const path = u.pathname && u.pathname !== "" ? u.pathname : "/";
  const gotoPath = `${path}${u.search}${u.hash}`;
  return { ok: true, baseUrl, gotoPath };
}

/** JSON = solo pasos después del primer `goto` (la URL de inicio ya abre la página). */
const DEFAULT_STEPS_JSON = JSON.stringify([{ action: "waitForSelector", selector: "h1" }], null, 2);

/**
 * Límites del objetivo (modo asistido). Mínimo: obliga a un objetivo concreto,
 * no una palabra suelta. Máximo: acota la superficie de prompt injection —
 * un goal es una frase, no un prompt pegado. El servidor revalida (no confiar
 * solo en el cliente).
 */
const GOAL_MIN_LENGTH = 10;
const GOAL_MAX_LENGTH = 500;

type Props = {
  onClose: () => void;
  onRunStarted: (run: RunRecord) => void;
};

type AssistPlanResponse = {
  ok: true;
  draft: {
    baseUrl: string;
    steps: Step[];
  };
  meta: AssistedMeta;
  mode?: "v1" | "v2";
};

export function NewRunModal({ onClose, onRunStarted }: Props) {
  const { projects, activeProjectId } = useAppContext();
  const { t } = useLanguage();
  const [tab, setTab] = useState<"assisted" | "advanced">("assisted");
  const [assistAvailable, setAssistAvailable] = useState(true);
  const [assistChecked, setAssistChecked] = useState(false);
  const [startUrl, setStartUrl] = useState("https://example.com/");
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stepsJson, setStepsJson] = useState(DEFAULT_STEPS_JSON);
  const [assistGoal, setAssistGoal] = useState("");
  const [victoryText, setVictoryText] = useState("");
  const [victorySelector, setVictorySelector] = useState("");
  const [victoryUrl, setVictoryUrl] = useState("");
  const [victoryMustAll, setVictoryMustAll] = useState(false);
  const [victoryOpen, setVictoryOpen] = useState(true);

  // El preflight es exclusivo del modo asistido: en avanzado los pasos ya vienen
  // dados, no hay plan que armar, así que se va directo al detalle de la run.
  const showPreflight = tab === "assisted" && (planning || loading);

  const submitDisabledReason = (() => {
    if (loading) return t("newRun.disabled.starting");
    if (planning) return t("newRun.disabled.planning");
    if (projects.length === 0) return t("newRun.disabled.noProjects");
    if (!assistChecked) return t("newRun.disabled.validating");
    if (tab === "assisted" && !assistAvailable) {
      return t("newRun.disabled.assistUnavailable");
    }
    if (tab === "assisted") {
      const goal = assistGoal.trim();
      if (!goal) return t("newRun.disabled.goalRequired");
      if (goal.length < GOAL_MIN_LENGTH) return t("newRun.goal.tooShort", { min: GOAL_MIN_LENGTH });
      if (goal.length > GOAL_MAX_LENGTH) return t("newRun.goal.tooLong", { max: GOAL_MAX_LENGTH });
      // Victoria obligatoria: sin ella el juez no puede declarar éxito y el run
      // termina "sin clasificar"/"inconclusivo". Exigimos al menos una señal.
      if (!victoryText.trim() && !victorySelector.trim() && !victoryUrl.trim()) {
        return t("newRun.victory.required");
      }
    }
    return null;
  })();
  const isSubmitDisabled = submitDisabledReason !== null;

  useEffect(() => {
    if (projectId) return;
    if (activeProjectId) {
      setProjectId(activeProjectId);
      return;
    }
    if (projects.length > 0) {
      setProjectId(projects[0]!.id);
    }
  }, [activeProjectId, projectId, projects]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/v1/ping");
        const body = (await res.json()) as { assistConfigured?: boolean };
        if (cancelled) return;
        const enabled = Boolean(body.assistConfigured);
        setAssistAvailable(enabled);
        if (!enabled) setTab("advanced");
      } catch {
        if (cancelled) return;
        setAssistAvailable(false);
        setTab("advanced");
      } finally {
        if (!cancelled) setAssistChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!projectId) {
      setError(t("newRun.error.projectRequired"));
      return;
    }

    const parsedUrl = parseStartUrl(startUrl, t);
    if (!parsedUrl.ok) {
      setError(parsedUrl.message);
      return;
    }
    const { baseUrl, gotoPath } = parsedUrl;
    const firstGoto: Step = { action: "goto", url: gotoPath };

    let steps: Step[];
    let assisted: AssistedMeta | undefined;
    if (tab === "advanced") {
      let extra: Step[];
      try {
        extra = JSON.parse(stepsJson) as Step[];
      } catch {
        setError(t("newRun.error.invalidJson"));
        return;
      }
      if (!Array.isArray(extra)) {
        setError(t("newRun.error.notArray"));
        return;
      }
      if (extra.length > 0 && extra[0]?.action === "goto") {
        setError(t("newRun.error.removeFirstGoto"));
        return;
      }
      steps = [firstGoto, ...extra];
      setLoading(true);
    } else {
      const goal = assistGoal.trim();
      if (!goal) {
        setError(t("newRun.disabled.goalRequired"));
        return;
      }
      if (goal.length < GOAL_MIN_LENGTH) {
        setError(t("newRun.goal.tooShort", { min: GOAL_MIN_LENGTH }));
        return;
      }
      if (goal.length > GOAL_MAX_LENGTH) {
        setError(t("newRun.goal.tooLong", { max: GOAL_MAX_LENGTH }));
        return;
      }
      if (!victoryText.trim() && !victorySelector.trim() && !victoryUrl.trim()) {
        setVictoryOpen(true);
        setError(t("newRun.victory.required"));
        return;
      }
      setPlanning(true);
      let planBody: AssistPlanResponse;
      try {
        const res = await apiFetch("/v1/plan", {
          method: "POST",
          body: JSON.stringify({
            project: projectId,
            baseUrl: parsedUrl.baseUrl,
            goal,
            mode: "v2",
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string } & Partial<AssistPlanResponse>;
        if (!res.ok || !body.ok || !body.draft || !body.meta) {
          setError(typeof body.error === "string" ? body.error : t("newRun.error.planFailed"));
          setPlanning(false);
          return;
        }
        planBody = body as AssistPlanResponse;
      } catch (err) {
        setError(err instanceof Error ? err.message : t("newRun.error.network"));
        setPlanning(false);
        return;
      }
      const plannedSteps = planBody.draft.steps ?? [];
      if (plannedSteps.length === 0) {
        setError(t("newRun.error.noExecutableSteps"));
        setPlanning(false);
        return;
      }
      steps = [firstGoto, ...plannedSteps];
      assisted = planBody.meta;
      setLoading(true);
      setPlanning(false);
    }
    let completed: RunRecord | null = null;
    try {
      const body: Record<string, unknown> = {
        baseUrl,
        steps,
        project: projectId,
        ...(assisted ? { assisted } : {}),
        headless: true,
        captureScreenshotAfterEachStep: true,
        // Toggle "Grabar video" de Configuración (localStorage). Off ⇒ sin video.
        recordVideoOnFailure: loadUiPrefs().video,
      };
      if (tab === "assisted" && assisted) {
        const victory = {
          ...(victoryText.trim() ? { textIncludes: [victoryText.trim()] } : {}),
          ...(victorySelector.trim() ? { selectorVisible: [victorySelector.trim()] } : {}),
          ...(victoryUrl.trim() ? { urlIncludes: [victoryUrl.trim()] } : {}),
          mustAll: victoryMustAll,
        };
        body.assist = {
          v2: true,
          goal: assisted.goal,
          ...(victoryText.trim() || victorySelector.trim() || victoryUrl.trim() ? { victory } : {}),
          maxHorizons: 12,
          stepsPerHorizon: 3,
          maxLoopMs: 300_000,
          memoryMode: "adaptive",
        };
      }
      const res = await apiFetch("/v1/run", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        const body = (await res.json()) as { error?: string; details?: unknown };
        setError(
          typeof body.error === "string"
            ? body.error
            : t("newRun.error.serverValidation"),
        );
        return;
      }
      const response = (await res.json()) as { id?: string; status?: string };
      if (!response?.id) {
        setError(t("newRun.error.noRunId"));
        return;
      }
      // Respuesta fire-and-forget: construimos un RunRecord mínimo en estado "running"
      // y navegamos inmediatamente al detalle, donde el SSE transmitirá eventos en vivo.
      completed = {
        id: response.id,
        status: "running",
        startedAt: new Date().toISOString(),
        durationMs: 0,
        baseUrl: body.baseUrl as string,
        project: projectId,
        steps: [],
      } as RunRecord;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("newRun.error.network"));
    } finally {
      setLoading(false);
    }

    if (!completed) return;
    onRunStarted(completed);
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-hidden rounded-ui border border-border bg-card p-6 shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-title text-foreground">{t("newRun.title")}</h2>
            <p className="mt-1 text-small text-muted-fg">{t("newRun.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => { if (!loading && !planning) onClose(); }}
            disabled={loading || planning}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-muted-fg hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            aria-label={t("newRun.close")}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {error && (
          <div className="flex shrink-0 items-start gap-3 rounded-control-lg border border-error-border bg-error px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" strokeWidth={2} aria-hidden />
            <div className="min-w-0">
              <p className="text-small font-button text-error-fg">{t("newRun.error.title")}</p>
              <p className="mt-0.5 break-words text-caption text-muted-fg">{error}</p>
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex gap-1 rounded-control-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                if (assistAvailable) setTab("assisted");
              }}
              disabled={!assistAvailable}
              className={`flex-1 rounded-control-md px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "assisted"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              {t("newRun.tab.assisted")}
            </button>
            <button
              type="button"
              onClick={() => setTab("advanced")}
              className={`flex-1 rounded-control-md px-2 py-2 text-caption font-button transition-colors sm:px-3 sm:text-small ${
                tab === "advanced"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-fg hover:text-foreground"
              }`}
            >
              {t("newRun.tab.advanced")}
            </button>
          </div>
          <p className="text-caption leading-snug text-muted-fg" id="run-mode-hint">
            {t(tab === "assisted" ? "newRun.mode.assisted.help" : "newRun.mode.advanced.help")}
          </p>
          {!assistAvailable && (
            <p className="text-caption text-warning-fg">
              {t("newRun.assistDisabled.prefix")}{" "}
              <span className="font-semibold">{t("newRun.assistDisabled.settingsPath")}</span>{" "}
              {t("newRun.assistDisabled.suffix")}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-describedby="run-mode-hint"
        >
          {/* Región de scroll única: todos los campos flotan acá; el footer queda fijo. */}
          <div className="ghostly-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="proj-select">
              {t("newRun.field.project")}
            </label>
            <select
              id="proj-select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              <p className="text-caption text-error-fg">
                {t("newRun.field.projectEmpty")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor="startUrl">
              {t("newRun.field.startUrl")}
            </label>
            <input
              id="startUrl"
              type="url"
              required
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="https://mi-app.com/login"
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-caption text-muted-fg">
              {t("newRun.field.startUrlHelp")}
            </p>
          </div>

          {tab === "advanced" ? (
            <div className="flex flex-col gap-1">
              <label className="text-caption text-muted-fg" htmlFor="stepsJson">
                {t("newRun.field.stepsJson")}
              </label>
              <p className="text-caption text-muted-fg">
                {t("newRun.advanced.stepsHelp.part1")} <span className="font-mono">goto</span>{t("newRun.advanced.stepsHelp.part2")}{" "}
                <span className="font-mono">[]</span> {t("newRun.advanced.stepsHelp.part3")}
              </p>
              <textarea
                id="stepsJson"
                rows={10}
                required
                value={stepsJson}
                onChange={(e) => setStepsJson(e.target.value)}
                className="min-h-[200px] rounded-control-md border border-border bg-background px-3 py-2 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-caption text-muted-fg" htmlFor="assist-goal">
                  {t("newRun.field.goal")}
                </label>
                <textarea
                  id="assist-goal"
                  rows={3}
                  value={assistGoal}
                  onChange={(e) => setAssistGoal(e.target.value)}
                  maxLength={GOAL_MAX_LENGTH}
                  placeholder={t("newRun.field.goalPlaceholder")}
                  className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="flex items-center justify-between text-caption text-muted-fg">
                  <span>{t("newRun.goal.minHint", { min: GOAL_MIN_LENGTH })}</span>
                  <span className={assistGoal.trim().length > GOAL_MAX_LENGTH ? "text-error-fg" : ""}>
                    {assistGoal.trim().length}/{GOAL_MAX_LENGTH}
                  </span>
                </p>
              </div>

              <div className="overflow-hidden rounded-control-lg border border-border bg-background">
                <button
                  type="button"
                  onClick={() => setVictoryOpen((v) => !v)}
                  aria-expanded={victoryOpen}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-brand-primary-soft text-primary">
                    <Target className="h-4 w-4" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-small font-button text-foreground">{t("newRun.victory.title")}</span>
                    <span className="mt-0.5 block text-caption text-muted-fg">{t("newRun.victory.subtitle")}</span>
                  </span>
                  {victoryOpen ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-fg" strokeWidth={2} aria-hidden />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-fg" strokeWidth={2} aria-hidden />
                  )}
                </button>

                {victoryOpen && (
                  <div className="flex flex-col gap-4 border-t border-border p-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-caption font-button text-foreground" htmlFor="victory-text">
                        {t("newRun.victory.textLabel")}
                      </label>
                      <input
                        id="victory-text"
                        value={victoryText}
                        onChange={(e) => setVictoryText(e.target.value)}
                        placeholder={t("newRun.victory.textPlaceholder")}
                        className="rounded-control-md border border-border bg-card px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-caption text-muted-fg">{t("newRun.victory.textHelp")}</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-caption font-button text-foreground" htmlFor="victory-selector">
                        {t("newRun.victory.selectorLabel")}
                      </label>
                      <input
                        id="victory-selector"
                        value={victorySelector}
                        onChange={(e) => setVictorySelector(e.target.value)}
                        placeholder={t("newRun.victory.selectorPlaceholder")}
                        className="rounded-control-md border border-border bg-card px-3 py-2 font-mono text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-caption text-muted-fg">{t("newRun.victory.selectorHelp")}</p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-caption font-button text-foreground" htmlFor="victory-url">
                        {t("newRun.victory.urlLabel")}
                      </label>
                      <input
                        id="victory-url"
                        value={victoryUrl}
                        onChange={(e) => setVictoryUrl(e.target.value)}
                        placeholder={t("newRun.victory.urlPlaceholder")}
                        className="rounded-control-md border border-border bg-card px-3 py-2 font-mono text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-caption text-muted-fg">{t("newRun.victory.urlHelp")}</p>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                      <span className="text-caption text-muted-fg">{t("newRun.victory.matchLabel")}</span>
                      <div className="flex shrink-0 gap-0.5 rounded-control-md bg-muted p-0.5">
                        <button
                          type="button"
                          onClick={() => setVictoryMustAll(false)}
                          aria-pressed={!victoryMustAll}
                          className={`rounded-control-sm px-3 py-1 text-caption font-button ${
                            victoryMustAll ? "text-muted-fg hover:text-foreground" : "bg-primary text-primary-fg"
                          }`}
                        >
                          {t("newRun.victory.any")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVictoryMustAll(true)}
                          aria-pressed={victoryMustAll}
                          className={`rounded-control-sm px-3 py-1 text-caption font-button ${
                            victoryMustAll ? "bg-primary text-primary-fg" : "text-muted-fg hover:text-foreground"
                          }`}
                        >
                          {t("newRun.victory.all")}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => { if (!loading && !planning) onClose(); }}
              disabled={loading || planning}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
            >
              {t("newRun.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-60"
            >
              {loading ? t("newRun.running") : t("newRun.submit")}
            </button>
          </div>
          {submitDisabledReason && (
            <p className="text-right text-caption text-muted-fg">{submitDisabledReason}</p>
          )}
        </form>
      </div>
    </div>

    {showPreflight && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-background p-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="w-full max-w-[440px] rounded-ui border border-border bg-card p-6 shadow-overlay">
          <p className="text-body font-title text-foreground">{t("newRun.preflight.title")}</p>

          {/* Indeterminada a propósito: /v1/plan es una sola request, no publica avance. */}
          <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-muted">
            <div className="ghostly-indeterminate h-full w-1/4 rounded-pill bg-primary" />
          </div>

          <div className="mt-5 flex flex-col gap-1">
            {[
              {
                key: "plan",
                label: t("newRun.preflight.plan.label"),
                detail: t("newRun.preflight.plan.detail", { url: startUrl.trim() }),
                done: !planning,
                active: planning,
              },
              {
                key: "start",
                label: t("newRun.preflight.start.label"),
                detail: t("newRun.preflight.start.detail"),
                done: false,
                active: !planning && loading,
              },
            ].map((phase) => (
              <div key={phase.key} className="flex items-start gap-3 py-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill ${
                    phase.done
                      ? "bg-success text-success-fg"
                      : phase.active
                      ? "bg-brand-primary-soft text-primary"
                      : "bg-muted text-muted-fg"
                  }`}
                >
                  {phase.done ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  ) : phase.active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
                  ) : (
                    <Circle className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-small ${
                      phase.done || phase.active ? "font-button text-foreground" : "text-muted-fg"
                    }`}
                  >
                    {phase.label}
                  </p>
                  <p className="mt-0.5 break-words text-caption text-muted-fg">{phase.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-center text-caption text-muted-fg">{t("newRun.preflight.footer")}</p>
        </div>
      </div>
    )}
    </>
  );
}
