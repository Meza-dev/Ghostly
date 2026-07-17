import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  FlagTriangleRight,
  Gavel,
  Heart,
  HeartCrack,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";
import { useLanguage } from "../context/language-context";
import type { MessageKey } from "../i18n/en";
import { getVerdictMeta } from "../lib/verdict";

type TranslateFn = ReturnType<typeof useLanguage>["t"];

export type AssistEventType =
  | "recon"
  | "plan_chunk"
  | "loop_state"
  | "horizon_start"
  | "horizon_end"
  | "victory_check"
  | "memory_hit"
  | "memory_miss"
  | "step_start"
  | "step_success"
  | "step_failure"
  | "heal_start"
  | "heal_action"
  | "heal_success"
  | "heal_failure"
  | "judge_verdict"
  | "run_end";

export type AssistEvent = {
  seq: number;
  type: AssistEventType;
  at: string;
  stepIndex?: number;
  payload: Record<string, unknown>;
};

type EventMeta = {
  labelKey: MessageKey;
  tone: "info" | "success" | "warn" | "error" | "muted";
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const EVENT_META: Record<AssistEventType, EventMeta> = {
  recon: { labelKey: "timeline.event.recon", tone: "info", icon: Eye },
  plan_chunk: { labelKey: "timeline.event.planChunk", tone: "info", icon: ClipboardList },
  loop_state: { labelKey: "timeline.event.loopState", tone: "info", icon: Bot },
  horizon_start: { labelKey: "timeline.event.horizonStart", tone: "info", icon: Play },
  horizon_end: { labelKey: "timeline.event.horizonEnd", tone: "info", icon: CheckCircle2 },
  victory_check: { labelKey: "timeline.event.victoryCheck", tone: "warn", icon: ShieldAlert },
  memory_hit: { labelKey: "timeline.event.memoryHit", tone: "success", icon: Heart },
  memory_miss: { labelKey: "timeline.event.memoryMiss", tone: "muted", icon: HeartCrack },
  step_start: { labelKey: "timeline.event.stepStart", tone: "muted", icon: Play },
  step_success: { labelKey: "timeline.event.stepSuccess", tone: "success", icon: CheckCircle2 },
  step_failure: { labelKey: "timeline.event.stepFailure", tone: "error", icon: XCircle },
  heal_start: { labelKey: "timeline.event.healStart", tone: "warn", icon: ShieldAlert },
  heal_action: { labelKey: "timeline.event.healAction", tone: "warn", icon: Bot },
  heal_success: { labelKey: "timeline.event.healSuccess", tone: "success", icon: Heart },
  heal_failure: { labelKey: "timeline.event.healFailure", tone: "error", icon: HeartCrack },
  judge_verdict: { labelKey: "timeline.event.judgeVerdict", tone: "warn", icon: Gavel },
  run_end: { labelKey: "timeline.event.runEnd", tone: "info", icon: FlagTriangleRight },
};

const TONE_CLASSES: Record<EventMeta["tone"], string> = {
  info: "text-primary",
  success: "text-success-fg",
  warn: "text-amber-500",
  error: "text-error-fg",
  muted: "text-muted-fg",
};

function formatPayload(t: TranslateFn, type: AssistEventType, payload: Record<string, unknown>): string {
  if (type === "recon") {
    const nodes = payload.nodeCount ?? 0;
    const url = typeof payload.url === "string" ? payload.url : "";
    return t("timeline.payload.recon", { url, nodes: String(nodes) });
  }
  if (type === "plan_chunk") {
    const steps = Array.isArray(payload.steps) ? payload.steps.length : 0;
    return `${t("timeline.payload.planChunk", { steps })}${payload.hasMore ? t("timeline.payload.hasMore") : ""}`;
  }
  if (type === "loop_state") {
    const state = typeof payload.state === "string" ? payload.state : "?";
    const reason = typeof payload.reason === "string" ? ` · ${payload.reason}` : "";
    return `${state}${reason}`;
  }
  if (type === "horizon_start" || type === "horizon_end") {
    const h = payload.horizon ?? "?";
    const pending = payload.pendingSteps ?? "?";
    return t("timeline.payload.horizon", { horizon: String(h), pending: String(pending) });
  }
  if (type === "victory_check") {
    // `objectiveLikelyCompleted`/`terminalStep` fueron eliminados del motor en
    // GHOST-28 (spec §4.2b): la victoria ahora se decide SOLO por verificación
    // determinista + juez, no por heurística de substring. No leer esos campos.
    const cfg = `configured=${String(payload.configured)}`;
    const met = `met=${String(payload.met)}`;
    const immediate = payload.immediate === true ? "immediate=true" : "";
    return [cfg, met, immediate].filter(Boolean).join(" · ");
  }
  if (type === "judge_verdict") {
    const reason = typeof payload.reason === "string" ? payload.reason : "?";
    const verdict = typeof payload.verdict === "string" ? payload.verdict : "?";
    const confidence = typeof payload.confidence === "string" ? payload.confidence : "?";
    const meta = getVerdictMeta(verdict);
    return t("timeline.payload.judge", { reason, verdict: t(meta.shortKey), confidence });
  }
  if (type === "memory_hit") {
    return t("timeline.payload.memoryHit", {
      horizon: String(payload.horizon ?? "?"),
      candidates: String(payload.candidates ?? "?"),
    });
  }
  if (type === "memory_miss") {
    return t("timeline.payload.memoryMiss", { horizon: String(payload.horizon ?? "?") });
  }
  if (type === "step_start" || type === "step_success" || type === "step_failure") {
    const step = payload.step;
    const stepStr = step ? JSON.stringify(step) : "";
    const err = typeof payload.error === "string" ? ` · ${payload.error}` : "";
    return `${stepStr}${err}`;
  }
  if (type === "heal_action") {
    const step = payload.step;
    const rationale = typeof payload.rationale === "string" ? ` · ${payload.rationale}` : "";
    return `${step ? JSON.stringify(step) : ""}${rationale}`;
  }
  if (type === "heal_start") {
    return t("timeline.payload.healStart", {
      attempt: String(payload.attempt ?? "?"),
      max: String(payload.maxAttempts ?? "?"),
    });
  }
  if (type === "heal_failure") {
    return typeof payload.error === "string" ? payload.error : typeof payload.reason === "string" ? payload.reason : "";
  }
  if (type === "run_end") {
    return t("timeline.payload.runEnd", {
      ok: String(payload.ok),
      steps: String(payload.totalSteps),
      failed: String(payload.failedSteps),
    });
  }
  return "";
}

type Props = { events: AssistEvent[] };

export function AssistTimeline({ events }: Props) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  if (!events || events.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-ui border border-border bg-card px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-left hover:opacity-80"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-fg" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-fg" strokeWidth={2} />
        )}
        <Bot className="h-4 w-4 text-primary" strokeWidth={2} />
        <span className="font-nav-active text-small text-foreground">{t("timeline.title")}</span>
        <span className="text-caption text-muted-fg">{t("timeline.eventCount", { count: events.length })}</span>
      </button>
      {open && (
      <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
        {events.map((evt) => {
          const meta = EVENT_META[evt.type] ?? EVENT_META.run_end;
          const Icon = meta.icon;
          const tone = TONE_CLASSES[meta.tone];
          const payloadSummary = formatPayload(t, evt.type, evt.payload);
          return (
            <li
              key={evt.seq}
              className="flex items-start gap-2 rounded-control-sm bg-muted px-2 py-1.5 text-caption"
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={2} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 text-foreground">
                  <span className="font-button">{t(meta.labelKey)}</span>
                  {evt.stepIndex !== undefined && (
                    <span className="rounded-pill bg-card px-1.5 py-0.5 text-micro text-muted-fg">
                      {t("timeline.step", { n: evt.stepIndex + 1 })}
                    </span>
                  )}
                  <span className="ml-auto text-micro text-muted-fg">
                    {new Date(evt.at).toLocaleTimeString(lang)}
                  </span>
                </div>
                {payloadSummary && (
                  <span className="break-all font-mono text-micro text-muted-fg">{payloadSummary}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
}
