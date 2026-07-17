import { useState } from "react";
import { useLanguage } from "../context/language-context";
import { ModalShell } from "./modal-shell";

type Props = {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
};

/** Modal "Añadir instrucciones": textarea libre que se appendea al goal asistido. */
export function AddInstructionsModal({ submitting, onClose, onSubmit }: Props) {
  const { t } = useLanguage();
  const [text, setText] = useState("");

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !text.trim()) return;
    onSubmit(text);
  }

  return (
    <ModalShell onClose={handleClose} className="w-[440px]">
      <span className="font-nav-active text-body text-foreground">{t("rerun.addInstructions.title")}</span>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted-fg" htmlFor="rerun-extra-instructions">
            {t("rerun.addInstructions.label")}
          </label>
          <textarea
            id="rerun-extra-instructions"
            rows={4}
            autoFocus
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("rerun.addInstructions.placeholder")}
            className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
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
            disabled={submitting || !text.trim()}
            className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
          >
            {submitting ? t("rerun.rerunning") : t("rerun.applyAndRerun")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
