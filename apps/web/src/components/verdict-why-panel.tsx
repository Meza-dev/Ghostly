import { useLanguage } from "../context/language-context";
import { getEffectiveVerdictMeta, getUserGroupMeta, getUserVerdictGroup } from "../lib/verdict";
import type { AssistEvent } from "./assist-timeline";

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
  status?: string | null;
  /** Eventos `judge_verdict` del run (ya redactados en origen — spec GHOST-35). */
  judgeEvents: AssistEvent[];
};

/**
 * Resumen editorial de la ejecución (rediseño RunDetail.dc): etiqueta del
 * veredicto + confianza, una frase grande en serif con el `verdictReason`, un
 * párrafo de apoyo con el razonamiento del juez, y la lista de evidencia.
 *
 * Todo el texto libre que llega acá ya pasó por el choke point de redacción del
 * runner (`redaction.ts`, GHOST-35) antes de persistirse — se renderiza tal
 * cual, sin re-sanitizar ni volver a buscar datos crudos.
 */
export function VerdictWhyPanel({ verdict, verdictReason, status, judgeEvents }: Props) {
  const { t } = useLanguage();
  const lastJudgeEvent = judgeEvents.length > 0 ? judgeEvents[judgeEvents.length - 1] : undefined;
  const judgePayload = lastJudgeEvent ? asJudgePayload(lastJudgeEvent.payload) : undefined;

  const reasoning = judgePayload?.reasoning;
  const headline = verdictReason ?? reasoning;
  if (!headline) return null;
  // El párrafo de apoyo solo aparece si aporta algo distinto de la frase grande.
  const support = reasoning && reasoning !== headline ? reasoning : undefined;

  // El panel del juez muestra el VEREDICTO REAL (los 6 estados), no el grupo:
  // es el "por qué" detallado. El punto de color sí usa el grupo para ser
  // consistente con los badges.
  const gm = getUserGroupMeta(getUserVerdictGroup(verdict, status));
  const realMeta = getEffectiveVerdictMeta(verdict, status);
  const evidence = judgePayload?.evidence ?? [];

  return (
    <div className="rounded-surface border border-border bg-card p-7">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-pill ${gm.dot}`} />
        <span className={`text-small font-button uppercase tracking-[0.04em] ${gm.text}`}>
          {t(realMeta.shortKey)}
        </span>
      </div>

      <p className="mt-5 font-serif text-xl leading-relaxed tracking-[-0.01em] text-foreground">
        {headline}
      </p>

      {support && <p className="mt-4 text-small leading-relaxed text-muted-fg">{support}</p>}

      {evidence.length > 0 && (
        <>
          <div className="my-6 h-px bg-border" />
          <p className="mb-3 text-overline font-overline uppercase tracking-[0.05em] text-muted-fg">
            {t("verdict.why.evidence")}
          </p>
          <ul className="flex flex-col gap-2.5">
            {evidence.map((item, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-text-tertiary" />
                <p className="text-small leading-relaxed text-muted-fg">{item}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
