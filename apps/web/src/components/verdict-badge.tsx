import { getEffectiveVerdictMeta, type VerdictTone } from "../lib/verdict";

const TONE_CLASSES: Record<VerdictTone, string> = {
  success: "bg-success text-success-fg",
  primary: "bg-brand-primary-soft text-primary",
  warning: "bg-warning text-warning-fg",
  muted: "bg-muted text-muted-fg",
};

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
  const meta = getEffectiveVerdictMeta(verdict, status);
  const sizing = size === "sm" ? "h-5 px-2 text-badge" : "h-6 px-2.5 text-caption";
  return (
    <span
      className={`inline-flex items-center rounded-pill font-button ${sizing} ${TONE_CLASSES[meta.tone]}`}
      title={meta.label}
    >
      {meta.shortLabel}
    </span>
  );
}
