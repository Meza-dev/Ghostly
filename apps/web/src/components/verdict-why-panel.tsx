import { Sparkles } from "lucide-react";
import { getVerdictMeta } from "../lib/verdict";
import type { AssistEvent } from "./assist-timeline";
import { VerdictBadge } from "./verdict-badge";

type JudgeVerdictPayload = {
  reason?: string;
  verdict?: string;
  confidence?: string;
  reasoning?: string;
  evidence?: string[];
};

function asJudgePayload(payload: Record<string, unknown>): JudgeVerdictPayload {
  return {
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    verdict: typeof payload.verdict === "string" ? payload.verdict : undefined,
    confidence: typeof payload.confidence === "string" ? payload.confidence : undefined,
    reasoning: typeof payload.reasoning === "string" ? payload.reasoning : undefined,
    evidence: Array.isArray(payload.evidence)
      ? payload.evidence.filter((e): e is string => typeof e === "string")
      : undefined,
  };
}

type Props = {
  verdict: string | null | undefined;
  verdictReason: string | null | undefined;
  /** Eventos `judge_verdict` del run (ya redactados en origen — spec GHOST-35). */
  judgeEvents: AssistEvent[];
};

/**
 * Panel "por qué" (spec §6): muestra el `verdictReason` persistido en el Run
 * más el razonamiento/evidencia de la última invocación del juez para este
 * veredicto. Todo el texto libre que llega acá ya pasó por el choke point de
 * redacción del runner (`redaction.ts`, GHOST-35) antes de persistirse —
 * se renderiza tal cual, sin re-sanitizar ni volver a buscar datos crudos.
 */
export function VerdictWhyPanel({ verdict, verdictReason, judgeEvents }: Props) {
  const lastJudgeEvent = judgeEvents.length > 0 ? judgeEvents[judgeEvents.length - 1] : undefined;
  const judgePayload = lastJudgeEvent ? asJudgePayload(lastJudgeEvent.payload) : undefined;

  if (!verdictReason && !judgePayload?.reasoning) return null;

  const meta = getVerdictMeta(verdict);

  return (
    <div className="rounded-surface border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {meta.isFinding ? (
          <Sparkles className="h-4 w-4 text-primary" strokeWidth={2} />
        ) : (
          <span className="h-4 w-4" />
        )}
        <p className="font-nav-active text-small text-foreground">Por qué</p>
        <VerdictBadge verdict={verdict} size="sm" />
      </div>

      {meta.isFinding && (
        <p className="mt-2 rounded-control-sm bg-brand-primary-soft px-3 py-2 text-small text-primary">
          Este test hizo su trabajo: encontró un bug real en la aplicación. No es un error de Ghostly.
        </p>
      )}

      {verdictReason && (
        <p className="mt-3 text-small text-foreground">{verdictReason}</p>
      )}

      {judgePayload?.reasoning && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-overline text-muted-fg">Razonamiento del juez</p>
          <p className="mt-1 text-small text-foreground">{judgePayload.reasoning}</p>
          {judgePayload.confidence && (
            <p className="mt-1 text-caption text-muted-fg">Confianza: {judgePayload.confidence}</p>
          )}
        </div>
      )}

      {judgePayload?.evidence && judgePayload.evidence.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-overline text-muted-fg">Evidencia</p>
          <ul className="mt-1 flex flex-col gap-1">
            {judgePayload.evidence.map((item, idx) => (
              <li key={idx} className="font-mono text-micro text-muted-fg">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
