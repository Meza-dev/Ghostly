import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  FlagTriangleRight,
  Heart,
  HeartCrack,
  Play,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";

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
  | "run_end";

export type AssistEvent = {
  seq: number;
  type: AssistEventType;
  at: string;
  stepIndex?: number;
  payload: Record<string, unknown>;
};

type EventMeta = {
  label: string;
  tone: "info" | "success" | "warn" | "error" | "muted";
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const EVENT_META: Record<AssistEventType, EventMeta> = {
  recon: { label: "Reconocimiento", tone: "info", icon: Eye },
  plan_chunk: { label: "Plan propuesto", tone: "info", icon: ClipboardList },
  loop_state: { label: "Estado del loop", tone: "info", icon: Bot },
  horizon_start: { label: "Horizonte iniciado", tone: "info", icon: Play },
  horizon_end: { label: "Horizonte finalizado", tone: "info", icon: CheckCircle2 },
  victory_check: { label: "Chequeo de victoria", tone: "warn", icon: ShieldAlert },
  memory_hit: { label: "Memoria reutilizada", tone: "success", icon: Heart },
  memory_miss: { label: "Sin memoria utilizable", tone: "muted", icon: HeartCrack },
  step_start: { label: "Paso iniciado", tone: "muted", icon: Play },
  step_success: { label: "Paso OK", tone: "success", icon: CheckCircle2 },
  step_failure: { label: "Paso falló", tone: "error", icon: XCircle },
  heal_start: { label: "Healer analizando", tone: "warn", icon: ShieldAlert },
  heal_action: { label: "Healer aplicando acción", tone: "warn", icon: Bot },
  heal_success: { label: "Healer recuperó", tone: "success", icon: Heart },
  heal_failure: { label: "Healer falló", tone: "error", icon: HeartCrack },
  run_end: { label: "Fin de ejecución", tone: "info", icon: FlagTriangleRight },
};

const TONE_CLASSES: Record<EventMeta["tone"], string> = {
  info: "text-primary",
  success: "text-success-fg",
  warn: "text-amber-500",
  error: "text-error-fg",
  muted: "text-muted-fg",
};

function formatPayload(type: AssistEventType, payload: Record<string, unknown>): string {
  if (type === "recon") {
    const nodes = payload.nodeCount ?? 0;
    const url = typeof payload.url === "string" ? payload.url : "";
    return `url=${url} · nodos=${nodes}`;
  }
  if (type === "plan_chunk") {
    const steps = Array.isArray(payload.steps) ? payload.steps.length : 0;
    return `${steps} pasos propuestos${payload.hasMore ? " (hay más)" : ""}`;
  }
  if (type === "loop_state") {
    const state = typeof payload.state === "string" ? payload.state : "?";
    const reason = typeof payload.reason === "string" ? ` · ${payload.reason}` : "";
    return `${state}${reason}`;
  }
  if (type === "horizon_start" || type === "horizon_end") {
    const h = payload.horizon ?? "?";
    const pending = payload.pendingSteps ?? "?";
    return `horizonte=${h} · pendientes=${pending}`;
  }
  if (type === "victory_check") {
    const cfg = `configured=${String(payload.configured)}`;
    const met = `met=${String(payload.met)}`;
    const obj = `objectiveLikelyCompleted=${String(payload.objectiveLikelyCompleted)}`;
    const immediate = payload.immediate === true ? "immediate=true" : "";
    const terminal = payload.terminalStep === true ? "terminalStep=true" : "";
    return [cfg, met, obj, immediate, terminal].filter(Boolean).join(" · ");
  }
  if (type === "memory_hit") {
    return `horizonte=${payload.horizon ?? "?"} · candidatos=${payload.candidates ?? "?"}`;
  }
  if (type === "memory_miss") {
    return `horizonte=${payload.horizon ?? "?"}`;
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
    return `intento ${payload.attempt ?? "?"}/${payload.maxAttempts ?? "?"}`;
  }
  if (type === "heal_failure") {
    return typeof payload.error === "string" ? payload.error : typeof payload.reason === "string" ? payload.reason : "";
  }
  if (type === "run_end") {
    return `ok=${payload.ok} · pasos=${payload.totalSteps} · fallados=${payload.failedSteps}`;
  }
  return "";
}

type Props = { events: AssistEvent[] };

export function AssistTimeline({ events }: Props) {
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
        <span className="font-nav-active text-small text-foreground">Timeline asistido (v2)</span>
        <span className="text-caption text-muted-fg">· {events.length} eventos</span>
      </button>
      {open && (
      <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
        {events.map((evt) => {
          const meta = EVENT_META[evt.type] ?? EVENT_META.run_end;
          const Icon = meta.icon;
          const tone = TONE_CLASSES[meta.tone];
          const payloadSummary = formatPayload(evt.type, evt.payload);
          return (
            <li
              key={evt.seq}
              className="flex items-start gap-2 rounded-control-sm bg-muted px-2 py-1.5 text-caption"
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} strokeWidth={2} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2 text-foreground">
                  <span className="font-button">{meta.label}</span>
                  {evt.stepIndex !== undefined && (
                    <span className="rounded-pill bg-card px-1.5 py-0.5 text-micro text-muted-fg">
                      paso {evt.stepIndex + 1}
                    </span>
                  )}
                  <span className="ml-auto text-micro text-muted-fg">
                    {new Date(evt.at).toLocaleTimeString("es")}
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
