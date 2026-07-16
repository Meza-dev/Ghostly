import { useState } from "react";
import { useLanguage } from "../context/language-context";
import type { EditableFillField } from "../lib/rerun-fields";
import { ModalShell } from "./modal-shell";

type Props = {
  fields: EditableFillField[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (overrides: Record<number, string>) => void;
};

/** Modal "Cambiar datos": un campo editable por cada step `fill` reconstruido del run. */
export function RerunDataModal({ fields, submitting, onClose, onSubmit }: Props) {
  const { t } = useLanguage();
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.replayIndex, field.sensitive ? "" : field.currentValue ?? ""])),
  );

  const hasEmptySensitive = fields.some((field) => field.sensitive && !values[field.replayIndex]?.trim());
  const canSubmit = !submitting && !hasEmptySensitive;

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(values);
  }

  return (
    <ModalShell onClose={handleClose} className="flex max-h-[80vh] w-[440px] flex-col gap-4 overflow-y-auto">
      <span className="font-nav-active text-body text-foreground">{t("rerun.changeData.title")}</span>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {fields.length === 0 && (
          <p className="text-caption text-muted-fg">{t("rerun.changeData.noFields")}</p>
        )}
        {fields.map((field) => (
          <div key={field.replayIndex} className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor={`rerun-field-${field.replayIndex}`}>
              {field.label}
            </label>
            <input
              id={`rerun-field-${field.replayIndex}`}
              type={field.sensitive ? "password" : "text"}
              required={field.sensitive}
              placeholder={field.sensitive ? t("rerun.changeData.sensitivePlaceholder") : undefined}
              value={values[field.replayIndex] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.replayIndex]: e.target.value }))
              }
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
          >
            {t("modal.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
          >
            {submitting ? t("rerun.rerunning") : t("rerun.applyAndRerun")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
