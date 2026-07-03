import { getVerdictMeta, type VerdictTone } from "../lib/verdict";

const TONE_CLASSES: Record<VerdictTone, string> = {
  success: "bg-success text-success-fg",
  primary: "bg-brand-primary-soft text-primary",
  warning: "bg-warning text-warning-fg",
  muted: "bg-muted text-muted-fg",
};

type Props = {
  verdict: string | null | undefined;
  /** `sm` para filas de listado, `md` (default) para el header del detalle. */
  size?: "sm" | "md";
};

/** Badge de veredicto (spec §5/§6 — taxonomía de 6 estados + "sin clasificar"). */
export function VerdictBadge({ verdict, size = "md" }: Props) {
  const meta = getVerdictMeta(verdict);
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
