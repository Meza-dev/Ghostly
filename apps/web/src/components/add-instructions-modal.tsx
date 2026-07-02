import { useState } from "react";
import { ModalShell } from "./modal-shell";

type Props = {
  open: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
};

/** Modal "Añadir instrucciones": textarea libre que se appendea al goal asistido. */
export function AddInstructionsModal({ open, submitting, onClose, onSubmit }: Props) {
  const [text, setText] = useState("");

  if (!open) return null;

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
      <span className="font-nav-active text-body text-foreground">Añadir instrucciones</span>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-caption text-muted-fg" htmlFor="rerun-extra-instructions">
            Instrucción adicional
          </label>
          <textarea
            id="rerun-extra-instructions"
            rows={4}
            autoFocus
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ejemplo: también validar el mensaje de bienvenida al finalizar."
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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
          >
            {submitting ? "Reejecutando…" : "Aplicar y reejecutar"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
