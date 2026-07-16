import { useLanguage } from "../context/language-context";
import type { MessageKey } from "../i18n/en";
import { ALL_VERDICTS, getEffectiveVerdictMeta, type Verdict, type VerdictTone } from "../lib/verdict";

const TONE_CLASSES: Record<VerdictTone, string> = {
  success: "bg-success text-success-fg",
  primary: "bg-brand-primary-soft text-primary",
  warning: "bg-warning text-warning-fg",
  muted: "bg-muted text-muted-fg",
};

/** Message keys por veredicto — el texto vive en i18n, la taxonomía en lib/verdict. */
const VERDICT_LABEL_KEYS = {
  success: { label: "verdict.success.label", short: "verdict.success.short" },
  "fail-app-bug": { label: "verdict.failAppBug.label", short: "verdict.failAppBug.short" },
  "fail-test-broken": { label: "verdict.failTestBroken.label", short: "verdict.failTestBroken.short" },
  "fail-agent-lost": { label: "verdict.failAgentLost.label", short: "verdict.failAgentLost.short" },
  "inconclusive-environment": {
    label: "verdict.inconclusiveEnvironment.label",
    short: "verdict.inconclusiveEnvironment.short",
  },
  inconclusive: { label: "verdict.inconclusive.label", short: "verdict.inconclusive.short" },
  unclassified: { label: "verdict.unclassified.label", short: "verdict.unclassified.short" },
} satisfies Record<Verdict | "unclassified", { label: MessageKey; short: MessageKey }>;

/** Mismo criterio que getEffectiveVerdictMeta: status="pass" sin veredicto ⇒ éxito. */
function effectiveVerdictKey(
  verdict: string | null | undefined,
  status: string | null | undefined,
): keyof typeof VERDICT_LABEL_KEYS {
  if (verdict && ALL_VERDICTS.includes(verdict as Verdict)) return verdict as Verdict;
  if (status === "pass") return "success";
  return "unclassified";
}

type Props = {
  verdict: string | null | undefined;
  /**
   * Status del run. Cuando el veredicto es `null` pero el status es `pass`
   * (victoria determinista limpia — el pipeline no setea `verdict="success"`
   * para no romper la guardia de memoria), el badge muestra "Éxito" en vez de
   * "sin clasificar".
   */
  status?: string | null;
  /** `sm` para filas de listado, `md` (default) para el header del detalle. */
  size?: "sm" | "md";
};

/** Badge de veredicto (spec §5/§6 — taxonomía de 6 estados + "sin clasificar"). */
export function VerdictBadge({ verdict, status, size = "md" }: Props) {
  const { t } = useLanguage();
  const meta = getEffectiveVerdictMeta(verdict, status);
  const labels = VERDICT_LABEL_KEYS[effectiveVerdictKey(verdict, status)];
  const sizing = size === "sm" ? "h-5 px-2 text-badge" : "h-6 px-2.5 text-caption";
  return (
    <span
      className={`inline-flex items-center rounded-pill font-button ${sizing} ${TONE_CLASSES[meta.tone]}`}
      title={t(labels.label)}
    >
      {t(labels.short)}
    </span>
  );
}
