import { useState } from "react";
import { useAppContext } from "../context/app-context";
import { useLanguage } from "../context/language-context";

type Props = {
  onClose: () => void;
  /** Para evitar ids duplicados si hay varias instancias montadas (raro). */
  inputId?: string;
};

export function NewProjectModal({ onClose, inputId = "proj-label" }: Props) {
  const { addProject } = useAppContext();
  const { t } = useLanguage();
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    await addProject(label.trim());
    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50">
      <div className="flex w-[400px] flex-col gap-4 rounded-ui border border-border bg-card p-6 shadow-xl">
        <span className="font-nav-active text-body text-foreground">{t("modal.newProject.title")}</span>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-caption text-muted-fg" htmlFor={inputId}>
              {t("modal.newProject.nameLabel")}
            </label>
            <input
              id={inputId}
              type="text"
              required
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("modal.newProject.namePlaceholder")}
              className="rounded-control-md border border-border bg-background px-3 py-2 text-small text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-pill border border-border px-4 py-2 text-small font-button text-foreground hover:bg-accent disabled:opacity-50"
            >
              {t("modal.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-pill bg-primary px-4 py-2 text-small font-button text-primary-fg hover:opacity-95 disabled:opacity-50"
            >
              {loading ? t("modal.newProject.creating") : t("modal.newProject.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
