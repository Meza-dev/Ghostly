import { ArrowLeft, Film } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RunRecord, Step } from "../../../../packages/runner/src/schema.js";
import { useRunStream } from "../hooks/use-run-stream";
import { apiFetch } from "../lib/api";
import { appendInstructionsToGoal, buildOverriddenSteps, deriveEditableFillFields } from "../lib/rerun-fields";
import { AddInstructionsModal } from "./add-instructions-modal";
import type { AssistEvent } from "./assist-timeline";
import { RerunDataModal } from "./rerun-data-modal";
import { RerunSplitButton } from "./rerun-split-button";

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

function asStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const action = obj.action;
  if (action === "goto" && typeof obj.url === "string") return { action: "goto", url: obj.url };
  if (action === "click" && typeof obj.selector === "string") return { action: "click", selector: obj.selector };
  if (action === "fill" && typeof obj.selector === "string" && typeof obj.value === "string") {
    return { action: "fill", selector: obj.selector, value: obj.value };
  }
  if (action === "press" && typeof obj.key === "string") return { action: "press", key: obj.key };
  if (action === "waitForSelector" && typeof obj.selector === "string") {
    return typeof obj.timeoutMs === "number"
      ? { action: "waitForSelector", selector: obj.selector, timeoutMs: obj.timeoutMs }
      : { action: "waitForSelector", selector: obj.selector };
  }
  if (action === "snapshot") return { action: "snapshot" };
  return null;
}

function getInitialGotoFromBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const path = parsed.pathname && parsed.pathname !== "" ? parsed.pathname : "/";
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function toBaseSectionPath(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0] ?? "/";
  if (!clean || clean === "/") return "/";
  const normalized = clean.endsWith("/") ? clean : clean.slice(0, clean.lastIndexOf("/") + 1);
  return normalized || "/";
}

function deriveRerunBaseUrl(currentBaseUrl: string, candidateSteps: Step[]): string {
  let current: URL;
  try {
    current = new URL(currentBaseUrl);
  } catch {
    return currentBaseUrl;
  }

  for (const step of candidateSteps) {
    if (step.action !== "goto") continue;
    const raw = step.url.trim();
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const target = new URL(raw);
        if (target.origin !== current.origin) continue;
        const section = toBaseSectionPath(target.pathname);
        return `${target.origin}${section}`;
      } catch {
        continue;
      }
    }
    if (raw.startsWith("/")) {
      const section = toBaseSectionPath(raw);
      return `${current.origin}${section}`;
    }
  }

  return currentBaseUrl;
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function timelineLabel(type: AssistEvent["type"]): string {
  const labels: Record<AssistEvent["type"], string> = {
    recon: "recon",
    plan_chunk: "plan inicial",
    loop_state: "estado loop",
    horizon_start: "horizonte inicia",
    horizon_end: "horizonte termina",
    victory_check: "victory check",
    memory_hit: "memory hit",
    memory_miss: "memory miss",
    step_start: "navigate",
    step_success: "step ok",
    step_failure: "fail",
    heal_start: "self-heal",
    heal_action: "heal action",
    heal_success: "heal success",
    heal_failure: "heal fail",
    run_end: "run end",
  };
  return labels[type] ?? type;
}

function timelineDetail(evt: AssistEvent): string {
  const payload = evt.payload as Record<string, unknown>;
  if (evt.type === "plan_chunk") {
    const steps = Array.isArray(payload.steps) ? payload.steps.length : 0;
    return `${steps} pasos generados desde objetivo + DOM snapshot`;
  }
  if (evt.type === "step_start" || evt.type === "step_success" || evt.type === "step_failure") {
    if (payload.step && typeof payload.step === "object") {
      return formatStepSummary(payload.step as Record<string, unknown>);
    }
  }
  if (evt.type === "heal_start") return "selector adaptado por heurística";
  if (evt.type === "step_failure" && typeof payload.error === "string") {
    return payload.error.split("\n")[0] ?? payload.error;
  }
  if (evt.type === "victory_check") {
    return payload.met === true ? "victory cumplida" : "victory selector ausente";
  }
  return JSON.stringify(payload).slice(0, 140);
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
  const [tab, setTab] = useState<"steps" | "timeline" | "code" | "artifacts">("steps");
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [copiedPlan, setCopiedPlan] = useState(false);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);

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
        setCancelError(body.error ?? "No se pudo cancelar la ejecución.");
        return;
      }
      await fetchRun();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "No se pudo cancelar la ejecución.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleRerun(options?: {
    valueOverrides?: Record<number, string>;
    extraInstructions?: string;
  }): Promise<void> {
    if (!run || rerunning || !run.project) return;
    const goal = run.assisted?.goal?.trim();
    const replaySteps = rerunnableSteps;
    const plannedSteps = plannedReplaySteps;
    const valueOverrides = options?.valueOverrides;
    const extraInstructions = options?.extraInstructions;
    const canUseAssistGoal = Boolean(goal);
    const canUseReplaySteps = replaySteps.length > 0;
    if (!valueOverrides && !extraInstructions && !canUseAssistGoal && !canUseReplaySteps) {
      setRerunError("No hay objetivo asistido ni pasos replayables para reejecutar.");
      return;
    }
    setRerunError(null);
    setRerunning(true);
    try {
      const body: Record<string, unknown> = {
        project: run.project,
        headless: true,
        captureScreenshotAfterEachStep: true,
        recordVideoOnFailure: true,
      };
      if (valueOverrides) {
        // "Cambiar datos": replay literal puro sobre los steps ejecutados, sin assist
        // ni goal, determinista sin importar isFullPlan (ADR-4). Nunca toca AssistMemory.
        body.baseUrl = run.baseUrl;
        body.steps = buildOverriddenSteps(replaySteps, valueOverrides, run.baseUrl);
      } else {
        const assistConfig = run.assisted?.assistConfig;
        const inheritedIsFullPlan =
          assistConfig?.isFullPlan ?? run.assisted?.model === "ghostly-mcp";
        const inheritedMemoryMode =
          assistConfig?.memoryMode ?? (inheritedIsFullPlan ? "runtime" : "adaptive");
        const effectiveBaseUrl = inheritedIsFullPlan
          ? deriveRerunBaseUrl(run.baseUrl, plannedSteps.length > 0 ? plannedSteps : replaySteps)
          : run.baseUrl;
        body.baseUrl = effectiveBaseUrl;
        if (extraInstructions && goal) {
          // "Añadir instrucciones": rama asistida con el goal enriquecido.
          const effectiveGoal = appendInstructionsToGoal(goal, extraInstructions);
          const firstStep: Step = { action: "goto", url: getInitialGotoFromBaseUrl(run.baseUrl) };
          const stepsForAssist = inheritedIsFullPlan && plannedSteps.length > 0
            ? plannedSteps
            : [firstStep];
          body.steps = stepsForAssist;
          body.assisted = { ...run.assisted, goal: effectiveGoal };
          body.assist = {
            v2: true,
            goal: effectiveGoal,
            isFullPlan: inheritedIsFullPlan,
            memoryMode: inheritedMemoryMode,
            ...(assistConfig?.victory ? { victory: assistConfig.victory } : {}),
            ...(assistConfig?.maxHorizons !== undefined ? { maxHorizons: assistConfig.maxHorizons } : {}),
            ...(assistConfig?.stepsPerHorizon !== undefined ? { stepsPerHorizon: assistConfig.stepsPerHorizon } : {}),
            ...(assistConfig?.maxLoopMs !== undefined ? { maxLoopMs: assistConfig.maxLoopMs } : {}),
          };
        } else if (canUseAssistGoal) {
          // "Reejecutar igual" (comportamiento actual, sin cambios).
          const firstStep: Step = { action: "goto", url: getInitialGotoFromBaseUrl(run.baseUrl) };
          const stepsForAssist = inheritedIsFullPlan && plannedSteps.length > 0
            ? plannedSteps
            : [firstStep];
          body.steps = stepsForAssist;
          body.assisted = run.assisted;
          body.assist = {
            v2: true,
            goal,
            isFullPlan: inheritedIsFullPlan,
            memoryMode: inheritedMemoryMode,
            ...(assistConfig?.victory ? { victory: assistConfig.victory } : {}),
            ...(assistConfig?.maxHorizons !== undefined ? { maxHorizons: assistConfig.maxHorizons } : {}),
            ...(assistConfig?.stepsPerHorizon !== undefined ? { stepsPerHorizon: assistConfig.stepsPerHorizon } : {}),
            ...(assistConfig?.maxLoopMs !== undefined ? { maxLoopMs: assistConfig.maxLoopMs } : {}),
          };
        } else {
          body.steps = replaySteps;
        }
      }
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

  const rerunnableSteps = useMemo<Step[]>(() => {
    const byIndex = new Map<number, Step>();
    for (const ev of mergedEvents) {
      if (typeof ev.stepIndex !== "number") continue;
      if (ev.type !== "step_start" && ev.type !== "step_success" && ev.type !== "step_failure") continue;
      const payload = ev.payload as Record<string, unknown>;
      const fromRaw = asStep(payload.rawStep);
      const fromRedacted = asStep(payload.step);
      const parsed = fromRaw ?? fromRedacted;
      if (parsed) byIndex.set(ev.stepIndex, parsed);
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, step]) => step);
  }, [mergedEvents]);

  const editableFillFields = useMemo(() => deriveEditableFillFields(rerunnableSteps), [rerunnableSteps]);

  const plannedReplaySteps = useMemo<Step[]>(() => {
    const steps: Step[] = [];
    for (const ev of mergedEvents) {
      if (ev.type !== "plan_chunk") continue;
      const payload = ev.payload as Record<string, unknown>;
      const rawSteps = payload.steps;
      if (!Array.isArray(rawSteps)) continue;
      for (const raw of rawSteps) {
        const parsed = asStep(raw);
        if (parsed) steps.push(parsed);
      }
    }
    return steps;
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

  useEffect(() => {
    if (displaySteps.length === 0) {
      setSelectedStepIndex(0);
      return;
    }
    const firstFailed = displaySteps.find((s) => s.ok === false)?.index ?? displaySteps[0].index;
    setSelectedStepIndex((current) => {
      const exists = displaySteps.some((s) => s.index === current);
      return exists ? current : firstFailed;
    });
  }, [displaySteps]);

  const selectedStep = displaySteps.find((s) => s.index === selectedStepIndex) ?? displaySteps[0] ?? null;

  useEffect(() => {
    setArtifactLoading(Boolean(selectedStep?.screenshotPath));
  }, [selectedStep?.screenshotPath]);

  const artifactItems = useMemo(() => {
    const items: Array<{ name: string; href: string; kind: "image" | "video" | "file" }> = [];
    if (run?.videoPath) {
      items.push({ name: run.videoPath.split(/[\\/]/).pop() ?? "video.webm", href: artifactUrl(run.videoPath), kind: "video" });
    }
    for (const step of displaySteps) {
      if (!step.screenshotPath) continue;
      const name = step.screenshotPath.split(/[\\/]/).pop() ?? `step-${step.index + 1}.png`;
      items.push({ name, href: artifactUrl(step.screenshotPath), kind: "image" });
    }
    return items;
  }, [displaySteps, run?.videoPath]);
  const videoHref = run?.videoPath ? artifactUrl(run.videoPath) : null;

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
  const canRerun = !isLive && Boolean(run.project) && (Boolean(run.assisted?.goal) || rerunnableSteps.length > 0);

  function handleChangeDataSubmit(overrides: Record<number, string>): void {
    setDataModalOpen(false);
    void handleRerun({ valueOverrides: overrides });
  }

  function handleAddInstructionsSubmit(text: string): void {
    setInstructionsModalOpen(false);
    void handleRerun({ extraInstructions: text });
  }

  return (
    <>
    <div className="ghostly-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-4">
      <button
        type="button"
        onClick={() => navigate("/runs")}
        className="inline-flex w-fit items-center gap-1.5 text-small text-muted-fg hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Volver a ejecuciones
      </button>

      <div className="rounded-surface border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[260px] space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex h-6 items-center rounded-pill px-2.5 text-caption font-button ${
                run.status === "pass"
                  ? "bg-success text-success-fg"
                  : run.status === "fail"
                  ? "bg-error text-error-fg"
                  : "bg-warning text-warning-fg"
              }`}>
                {run.status === "pass" ? "Pass" : run.status === "fail" ? "Fail" : "Run"}
              </span>
              <span className="text-caption uppercase tracking-wide text-muted-fg">{run.project ?? "sin proyecto"}</span>
            </div>
            <h1 className="text-xl font-title tracking-tight text-foreground">{objective || `Run ${run.id.slice(0, 9)}`}</h1>
            <div className="flex flex-wrap items-center gap-2 font-mono text-caption text-muted-fg">
              <span>{run.baseUrl}</span>
              <span>·</span>
              <span>{run.id.slice(0, 9)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {videoHref && (
              <button
                type="button"
                onClick={() => window.open(videoHref, "_blank", "noopener,noreferrer")}
                className="inline-flex items-center gap-1.5 rounded-control-sm border border-border bg-muted px-3 py-1.5 text-small font-button text-foreground hover:bg-bg-muted"
              >
                <Film className="h-3.5 w-3.5" />
                Ver video
              </button>
            )}
            {isLive ? (
              <button
                type="button"
                onClick={() => void handleCancelRun()}
                disabled={cancelling}
                className="rounded-control-sm border border-error-fg/40 bg-error/20 px-3 py-1.5 text-small text-error-fg hover:bg-error/30 disabled:opacity-60"
              >
                {cancelling ? "Cancelando..." : "Cancelar ejecución"}
              </button>
            ) : (
              <RerunSplitButton
                disabled={!canRerun}
                rerunning={rerunning}
                canChangeData={editableFillFields.length > 0}
                canAddInstructions={Boolean(run.assisted?.goal)}
                onRerunSame={() => void handleRerun()}
                onChangeData={() => setDataModalOpen(true)}
                onAddInstructions={() => setInstructionsModalOpen(true)}
              />
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-5 border-t border-border pt-4 sm:grid-cols-4">
          <div><p className="text-overline text-muted-fg">Duración</p><p className="text-2xl font-title leading-none">{formatDuration(run.durationMs)}</p></div>
          <div><p className="text-overline text-muted-fg">Pasos</p><p className="text-2xl font-title leading-none">{run.steps.filter((s) => s.ok).length}/{run.steps.length}</p></div>
          <div><p className="text-overline text-muted-fg">Self-heals</p><p className="text-2xl font-title leading-none">{displaySteps.filter((s) => s.healed).length}</p></div>
          <div><p className="text-overline text-muted-fg">Iniciado</p><p className="text-md font-mono text-muted-fg">{new Date(run.startedAt).toLocaleString()}</p></div>
        </div>
      </div>

      {(cancelError || rerunError) && (
        <p className="rounded-control-sm bg-error px-3 py-2 text-caption text-error-fg">{cancelError ?? rerunError}</p>
      )}

      <div className="flex items-end gap-1 border-b border-border">
        {[
          { id: "steps", label: "Pasos" },
          { id: "timeline", label: "Timeline" },
          { id: "code", label: "Plan" },
          { id: "artifacts", label: "Artefactos" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={`relative px-4 py-2 text-small ${
              tab === t.id ? "font-button text-foreground" : "text-muted-fg hover:text-foreground"
            }`}
          >
            {t.label}
            <span className={`absolute bottom-0 left-2 right-2 h-0.5 bg-primary transition-transform ${tab === t.id ? "scale-x-100" : "scale-x-0"}`} />
          </button>
        ))}
      </div>

      {tab === "steps" && (
        <div className="grid min-h-[min(72vh,720px)] gap-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(340px,1fr)]">
          <div className="ghostly-scrollbar flex max-h-[min(72vh,720px)] min-h-0 flex-col overflow-y-auto rounded-surface border border-border bg-card">
            {displaySteps.map((step) => (
              <button
                key={step.index}
                type="button"
                onClick={() => {
                  setSelectedStepIndex(step.index);
                  if (step.screenshotPath) setArtifactLoading(true);
                }}
                className={`grid w-full grid-cols-[32px_16px_96px_1fr_64px] items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted ${
                  selectedStep?.index === step.index ? "bg-muted" : ""
                }`}
              >
                <span className="font-mono text-caption text-muted-fg">{String(step.index + 1).padStart(2, "0")}</span>
                <span className={`h-3.5 w-3.5 rounded-full ${step.ok === false ? "bg-error-fg" : step.ok === true ? "bg-success-fg" : "bg-primary"}`} />
                <span className="font-mono text-small text-primary">{step.action}</span>
                <span className="truncate font-mono text-small text-muted-fg">{step.error ?? "Paso ejecutado"}</span>
                <span className="text-right font-mono text-caption text-muted-fg">{step.ok === null ? "..." : step.ok ? "ok" : "fail"}</span>
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-col gap-2 lg:sticky lg:top-3 lg:self-start">
            <p className="text-overline text-muted-fg">Snapshot · paso {(selectedStep?.index ?? 0) + 1}</p>
            <div className="relative min-h-[min(68vh,620px)] w-full overflow-hidden rounded-control-sm border border-border bg-bg-muted lg:aspect-auto">
              {artifactLoading && (
                <div className="absolute inset-0 animate-pulse bg-muted" />
              )}
              {selectedStep?.screenshotPath && (
                <img
                  key={selectedStep.screenshotPath}
                  src={artifactUrl(selectedStep.screenshotPath)}
                  alt={`Paso ${selectedStep.index + 1}`}
                  className="h-full w-full object-contain"
                  onLoad={() => setArtifactLoading(false)}
                  onError={() => setArtifactLoading(false)}
                />
              )}
              {!selectedStep?.screenshotPath && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-caption text-muted-fg">
                  Sin screenshot para este paso
                </div>
              )}
            </div>
            {selectedStep?.error && (
              <p className="rounded-control-sm bg-error px-3 py-2 text-caption text-error-fg">{selectedStep.error}</p>
            )}
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <div className="overflow-hidden rounded-surface border border-border bg-card">
          {mergedEvents.length === 0 ? (
            <p className="p-4 text-small text-muted-fg">Sin eventos.</p>
          ) : (
            <ol className="ghostly-scrollbar max-h-[560px] overflow-auto">
              {mergedEvents.map((evt, idx) => {
                const firstAt = mergedEvents[0]?.at ? new Date(mergedEvents[0].at).getTime() : 0;
                const currentAt = evt.at ? new Date(evt.at).getTime() : firstAt;
                const rel = Math.max(0, currentAt - firstAt);
                return (
                  <li
                    key={`${evt.seq}-${evt.type}`}
                    className={`grid grid-cols-[72px_1fr] gap-4 px-4 py-3 ${idx < mergedEvents.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <span className="pt-0.5 text-right font-mono text-caption text-muted-fg">+{(rel / 1000).toFixed(2)}s</span>
                    <div className="min-w-0">
                      <p className={`text-small font-button ${
                        evt.type === "step_failure" || evt.type === "heal_failure"
                          ? "text-error-fg"
                          : evt.type === "step_success" || evt.type === "heal_success"
                          ? "text-success-fg"
                          : "text-foreground"
                      }`}>
                        {timelineLabel(evt.type)}
                      </p>
                      <p className="mt-0.5 break-words font-mono text-small text-muted-fg">{timelineDetail(evt)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {tab === "code" && (
        <div className="rounded-surface border border-border bg-card p-3">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                const planJson = JSON.stringify(
                  executedStepsJson.length > 0 ? executedStepsJson : fullPlannedSteps,
                  null,
                  2,
                );
                void navigator.clipboard.writeText(planJson).then(() => {
                  setCopiedPlan(true);
                  setTimeout(() => setCopiedPlan(false), 1500);
                });
              }}
              className="rounded-control-sm border border-border bg-muted px-2.5 py-1 text-caption text-muted-fg hover:text-foreground"
            >
              {copiedPlan ? "Copiado" : "Copiar JSON"}
            </button>
          </div>
          <pre className="ghostly-scrollbar max-h-80 overflow-auto rounded-control-sm border border-border bg-muted/40 p-3 font-mono text-micro text-foreground">
            {JSON.stringify(executedStepsJson.length > 0 ? executedStepsJson : fullPlannedSteps, null, 2)}
          </pre>
          {loopProgress.loopState && <p className="mt-2 text-caption text-muted-fg">Estado loop: {loopProgress.loopState}</p>}
        </div>
      )}

      {tab === "artifacts" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {artifactItems.map((item) => (
            <a
              key={`${item.kind}-${item.href}`}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-surface border border-border bg-card p-3 hover:border-primary"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-control-sm border border-border bg-muted font-mono text-caption text-muted-fg">
                {item.kind === "video" ? <Film className="h-4 w-4" /> : item.name.split(".").pop()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-small text-foreground">{item.name}</p>
                <p className="text-caption text-muted-fg">Descargar</p>
              </div>
            </a>
          ))}
          {artifactItems.length === 0 && (
            <p className="text-small text-muted-fg">No hay artefactos disponibles para esta ejecución.</p>
          )}
        </div>
      )}

    </div>
    {dataModalOpen && (
      <RerunDataModal
        open={dataModalOpen}
        fields={editableFillFields}
        submitting={rerunning}
        onClose={() => setDataModalOpen(false)}
        onSubmit={handleChangeDataSubmit}
      />
    )}
    {instructionsModalOpen && (
      <AddInstructionsModal
        open={instructionsModalOpen}
        submitting={rerunning}
        onClose={() => setInstructionsModalOpen(false)}
        onSubmit={handleAddInstructionsSubmit}
      />
    )}
    </>
  );
}
