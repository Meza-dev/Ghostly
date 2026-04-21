import { ArrowLeft, CheckCircle, Film, Loader2, Radio, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RunRecord, Step } from "../../../../packages/runner/src/schema.js";
import { useRunStream } from "../hooks/use-run-stream";
import { apiFetch } from "../lib/api";
import { AssistTimeline, type AssistEvent } from "./assist-timeline";

type RunRecordWithEvents = RunRecord & { events?: AssistEvent[] };
type PlanChunkSummary = {
  seq: number;
  horizon?: number;
  replannedFromError: boolean;
  steps: string[];
};

type RunStartResponse = {
  ok: true;
  id: string;
  status: "running";
};

function getInitialGotoFromBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const path = parsed.pathname && parsed.pathname !== "" ? parsed.pathname : "/";
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function artifactUrl(filePath: string): string {
  // Extrae todo lo que va después de "artifacts\" o "artifacts/"
  // y construye la URL relativa /artifacts/run-xxx/step-N-ok.png
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/artifacts/";
  const idx = normalized.indexOf(marker);
  const relative = idx !== -1 ? normalized.slice(idx + marker.length) : normalized.split("/").pop() ?? "";
  return `/artifacts/${relative}`;
}

function formatStepSummary(step: Record<string, unknown>): string {
  const action = typeof step.action === "string" ? step.action : "step";
  if (action === "goto") return `goto ${String(step.url ?? "")}`;
  if (action === "click") return `click ${String(step.selector ?? "")}`;
  if (action === "fill") return `fill ${String(step.selector ?? "")}`;
  if (action === "press") return `press ${String(step.key ?? "")}`;
  if (action === "waitForSelector") return `waitForSelector ${String(step.selector ?? "")}`;
  if (action === "snapshot") return "snapshot";
  return JSON.stringify(step);
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunRecordWithEvents | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const fetchRun = async () => {
    if (!id) return;
    const r = await apiFetch(`/v1/runs/${id}`);
    if (r.status === 404) {
      setNotFound(true);
      return;
    }
    const data = (await r.json()) as RunRecordWithEvents;
    setRun(data);
  };

  useEffect(() => {
    void fetchRun().catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Stream en vivo: si el run está en "running" abre SSE; cuando termina, refetch.
  const stream = useRunStream(id, run?.status ?? "running");

  useEffect(() => {
    if (stream.finished || (stream.status !== "running" && run?.status === "running")) {
      void fetchRun().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.finished, stream.status]);

  const isLive = run?.status === "running" && !stream.finished;

  async function handleCancelRun(): Promise<void> {
    if (!id || !isLive || cancelling) return;
    setCancelError(null);
    setCancelling(true);
    try {
      const res = await apiFetch(`/v1/runs/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setCancelError(body.error ?? "No se pudo cancelar la corrida.");
        return;
      }
      await fetchRun();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "No se pudo cancelar la corrida.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleRerun(): Promise<void> {
    if (!run || rerunning || !run.project) return;
    const goal = run.assisted?.goal?.trim();
    if (!goal) {
      setRerunError("Solo se puede reejecutar corridas asistidas con objetivo.");
      return;
    }
    setRerunError(null);
    setRerunning(true);
    try {
      const firstStep: Step = { action: "goto", url: getInitialGotoFromBaseUrl(run.baseUrl) };
      const assistConfig = run.assisted?.assistConfig;
      const body: Record<string, unknown> = {
        baseUrl: run.baseUrl,
        steps: [firstStep],
        project: run.project,
        assisted: run.assisted,
        headless: true,
        captureScreenshotAfterEachStep: true,
        recordVideoOnFailure: true,
        assist: {
          v2: true,
          goal,
          memoryMode: assistConfig?.memoryMode ?? "adaptive",
          ...(assistConfig?.victory ? { victory: assistConfig.victory } : {}),
          ...(assistConfig?.maxHorizons !== undefined ? { maxHorizons: assistConfig.maxHorizons } : {}),
          ...(assistConfig?.stepsPerHorizon !== undefined ? { stepsPerHorizon: assistConfig.stepsPerHorizon } : {}),
          ...(assistConfig?.maxLoopMs !== undefined ? { maxLoopMs: assistConfig.maxLoopMs } : {}),
        },
      };
      const res = await apiFetch("/v1/run", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string } & Partial<RunStartResponse>;
      if (!res.ok || !payload.id) {
        setRerunError(payload.error ?? "No se pudo iniciar la reejecución.");
        return;
      }
      navigate(`/runs/${payload.id}`);
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : "No se pudo iniciar la reejecución.");
    } finally {
      setRerunning(false);
    }
  }

  // Mezcla eventos persistidos + streameados, ordenados por seq, deduplicados.
  const mergedEvents = useMemo<AssistEvent[]>(() => {
    const base = run?.events ?? [];
    const byKey = new Map<string, AssistEvent>();
    for (const e of [...base, ...stream.events]) {
      byKey.set(`${e.seq}-${e.type}`, e);
    }
    return Array.from(byKey.values()).sort((a, b) => a.seq - b.seq);
  }, [run?.events, stream.events]);

  const loopProgress = useMemo(() => {
    const horizons = mergedEvents
      .filter((e) => e.type === "horizon_end")
      .map((e) => Number((e.payload as Record<string, unknown>).horizon))
      .filter((n) => Number.isFinite(n) && n > 0);
    const maxHorizon = horizons.length > 0 ? Math.max(...horizons) : 0;
    const lastVictory = [...mergedEvents].reverse().find((e) => e.type === "victory_check");
    const victoryMet = lastVictory ? (lastVictory.payload as Record<string, unknown>).met === true : false;
    const lastLoopState = [...mergedEvents].reverse().find((e) => e.type === "loop_state");
    const loopState = lastLoopState
      ? String((lastLoopState.payload as Record<string, unknown>).state ?? "")
      : "";
    return { maxHorizon, victoryMet, loopState };
  }, [mergedEvents]);

  const objective = run?.assisted?.goal ?? "";

  const planChunks = useMemo<PlanChunkSummary[]>(() => {
    return mergedEvents
      .filter((ev) => ev.type === "plan_chunk")
      .map((ev) => {
        const payload = ev.payload as Record<string, unknown>;
        const rawSteps = payload.steps;
        const steps = Array.isArray(rawSteps)
          ? rawSteps
              .filter((step): step is Record<string, unknown> => !!step && typeof step === "object")
              .map((step) => formatStepSummary(step))
          : [];
        const horizonRaw = payload.horizon;
        const horizon = typeof horizonRaw === "number" && Number.isFinite(horizonRaw) ? horizonRaw : undefined;
        const replannedFromError = payload.replannedFromError === true;
        return { seq: ev.seq, horizon, replannedFromError, steps };
      })
      .filter((chunk) => chunk.steps.length > 0);
  }, [mergedEvents]);

  const fullPlannedSteps = useMemo<string[]>(() => {
    if (planChunks.length > 0) {
      return planChunks.flatMap((chunk) => chunk.steps);
    }
    if (run?.steps?.length) {
      return run.steps.map((step) => formatStepSummary(step as unknown as Record<string, unknown>));
    }
    return [];
  }, [planChunks, run?.steps]);

  /** Pasos con el mismo contrato JSON que envía/ejecuta el runner (desde eventos SSE/DB). */
  const executedStepsJson = useMemo<Record<string, unknown>[]>(() => {
    const byIndex = new Map<number, Record<string, unknown>>();
    for (const ev of mergedEvents) {
      if (typeof ev.stepIndex !== "number") continue;
      if (ev.type !== "step_start" && ev.type !== "step_success" && ev.type !== "step_failure") continue;
      const step = (ev.payload as Record<string, unknown>).step;
      if (step && typeof step === "object") {
        byIndex.set(ev.stepIndex, step as Record<string, unknown>);
      }
    }
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, s]) => s);
  }, [mergedEvents]);

  // Durante la ejecución derivamos los pasos visibles desde los eventos en vivo;
  // al terminar, usamos los pasos persistidos del run.
  type DisplayStep = {
    index: number;
    action: string;
    ok: boolean | null;
    error?: string;
    screenshotPath?: string;
    healed?: boolean;
  };
  const displaySteps = useMemo<DisplayStep[]>(() => {
    if (run && run.steps.length > 0) {
      return run.steps.map((s) => ({
        index: s.index,
        action: s.action,
        ok: s.ok,
        ...(s.error ? { error: s.error } : {}),
        ...(s.screenshotPath ? { screenshotPath: s.screenshotPath } : {}),
      }));
    }
    const byIndex = new Map<number, DisplayStep>();
    for (const ev of mergedEvents) {
      if (typeof ev.stepIndex !== "number") continue;
      const p = ev.payload as Record<string, unknown>;
      const step = p.step as { action?: string } | undefined;
      const action = typeof step?.action === "string" ? step.action : ev.type;
      const current = byIndex.get(ev.stepIndex) ?? {
        index: ev.stepIndex,
        action,
        ok: null,
      };
      current.action = action;
      if (ev.type === "step_success") {
        current.ok = true;
        if (typeof p.screenshotPath === "string") current.screenshotPath = p.screenshotPath;
        if (p.healed === true) current.healed = true;
      } else if (ev.type === "step_failure" && p.final === true) {
        current.ok = false;
        if (typeof p.error === "string") current.error = p.error;
        if (typeof p.screenshotPath === "string") current.screenshotPath = p.screenshotPath;
      }
      byIndex.set(ev.stepIndex, current);
    }
    return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  }, [run, mergedEvents]);

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-fg">
        <p className="text-body">Run no encontrado</p>
        <button type="button" onClick={() => navigate("/")} className="text-small text-primary underline">
          Volver al listado
        </button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center text-small text-muted-fg">
        Cargando…
      </div>
    );
  }
  const canRerun = !isLive && Boolean(run.project) && Boolean(run.assisted?.goal);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-4">
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-small text-muted-fg hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Volver
        </button>
        <span className="text-caption text-muted-fg">/</span>
        <span className="truncate font-nav-active text-foreground text-small">{run.id}</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-start gap-4 rounded-ui border border-border bg-card px-4 py-3 text-small">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Estado</span>
          <span
            className={
              run.status === "pass"
                ? "text-success-fg font-button"
                : run.status === "fail"
                ? "text-error-fg font-button"
                : "text-primary font-button"
            }
          >
            {run.status === "pass"
              ? "Pasó"
              : run.status === "fail"
              ? "Falló"
              : "Corriendo…"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">URL base</span>
          <span className="text-foreground">{run.baseUrl}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Duración</span>
          <span className="text-foreground">
            {run.status === "running" ? "—" : `${(run.durationMs / 1000).toFixed(2)}s`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted-fg">Inicio</span>
          <span className="text-foreground">{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        {run.videoPath && (
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted-fg">Video</span>
            <a
              href={artifactUrl(run.videoPath)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Film className="h-3.5 w-3.5" strokeWidth={2} />
              Ver video
            </a>
          </div>
        )}
        {isLive && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-[4px] border border-primary/40 bg-primary/10 px-2.5 py-1 text-primary">
              {stream.connected ? (
                <Radio className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              )}
              <span className="text-caption font-button">
                {stream.connected ? "En vivo" : "Conectando…"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleCancelRun()}
              disabled={cancelling}
              className="rounded-[4px] border border-error-fg/40 bg-error/20 px-2.5 py-1 text-caption text-error-fg hover:bg-error/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelling ? "Cancelando..." : "Cancelar corrida"}
            </button>
          </div>
        )}
        {!isLive && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRerun()}
              disabled={!canRerun || rerunning}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-primary/40 bg-primary/10 px-2.5 py-1 text-caption text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              title={canRerun ? "Reejecutar con el mismo objetivo" : "Requiere corrida asistida con proyecto"}
            >
              {rerunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {rerunning ? "Reejecutando..." : "Reejecutar"}
            </button>
          </div>
        )}
      </div>

      {cancelError && (
        <p className="rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">{cancelError}</p>
      )}
      {rerunError && (
        <p className="rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">{rerunError}</p>
      )}

      {mergedEvents.length > 0 && <AssistTimeline events={mergedEvents} />}

      <div className="flex flex-wrap items-center gap-2 rounded-ui border border-border bg-card px-4 py-3">
        <span className="font-nav-active text-small text-foreground">Progreso por horizontes</span>
        <span className="rounded-[4px] bg-muted px-2 py-0.5 text-caption text-muted-fg">
          horizontes completados: {loopProgress.maxHorizon}
        </span>
        <span
          className={`rounded-[4px] px-2 py-0.5 text-caption ${
            loopProgress.victoryMet ? "bg-success/15 text-success-fg" : "bg-muted text-muted-fg"
          }`}
        >
          victoria: {loopProgress.victoryMet ? "cumplida" : "pendiente"}
        </span>
        {loopProgress.loopState && (
          <span className="rounded-[4px] bg-primary/10 px-2 py-0.5 text-caption text-primary">
            estado: {loopProgress.loopState}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-ui border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-nav-active text-small text-foreground">Objetivo enviado</span>
          <p className="text-caption text-muted-fg">{objective || "No disponible para esta corrida."}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-nav-active text-small text-foreground">Plan armado (completo)</span>
          {fullPlannedSteps.length > 0 ? (
            <ol className="list-decimal pl-5 text-caption text-muted-fg">
              {fullPlannedSteps.map((step, idx) => (
                <li key={`${idx}-${step}`} className="break-all font-mono text-[11px]">
                  {step}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-caption text-muted-fg">No disponible para esta corrida.</p>
          )}
          {planChunks.length > 0 && (
            <p className="text-caption text-muted-fg">
              {fullPlannedSteps.length} pasos acumulados en {planChunks.length} bloques de planificación.
            </p>
          )}
        </div>
      </div>

      {executedStepsJson.length > 0 && (
        <div className="flex flex-col gap-2 rounded-ui border border-border bg-card px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="font-nav-active text-small text-foreground">Pasos ejecutados (JSON Playwright)</span>
            <p className="text-caption text-muted-fg">
              Mismo formato que el array <code className="text-[11px]">steps</code> del cuerpo de corrida:{" "}
              <code className="text-[11px]">goto</code>, <code className="text-[11px]">click</code>,{" "}
              <code className="text-[11px]">fill</code>, <code className="text-[11px]">press</code>,{" "}
              <code className="text-[11px]">waitForSelector</code>, <code className="text-[11px]">snapshot</code>. Se
              reconstruye desde los eventos del run (cada índice es el último payload de ese paso). Playwright no
              «solo busca por texto»: <code className="text-[11px]">:has-text()</code> es un selector CSS del motor; el
              runner además prueba <code className="text-[11px]">getByRole</code>,{" "}
              <code className="text-[11px]">aria-label</code> y variantes cuando aplica.
            </p>
          </div>
          <pre className="max-h-72 overflow-auto rounded-[4px] border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(executedStepsJson, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2">
        <span className="font-nav-active text-small text-foreground">Pasos ejecutados</span>
        <span className="text-caption text-muted-fg">· {displaySteps.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {displaySteps.map((step) => (
          <div
            key={step.index}
            className="flex flex-col gap-2 rounded-ui border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-2">
              {step.ok === true ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-success-fg" strokeWidth={2} />
              ) : step.ok === false ? (
                <XCircle className="h-4 w-4 shrink-0 text-error-fg" strokeWidth={2} />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" strokeWidth={2} />
              )}
              <span className="font-nav-active text-small text-foreground">
                Paso {step.index + 1} — {step.action}
              </span>
              {step.healed && (
                <span className="rounded-[4px] bg-primary/10 px-1.5 py-0.5 text-caption text-primary">
                  auto-corregido
                </span>
              )}
            </div>

            {step.error && (
              <p className="rounded-[4px] bg-error px-3 py-2 text-caption text-error-fg">
                {step.error}
              </p>
            )}

            {step.screenshotPath && (
              <img
                src={artifactUrl(step.screenshotPath)}
                alt={`Screenshot paso ${step.index + 1}`}
                className="max-h-64 w-full rounded-[4px] border border-border object-contain object-top"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
