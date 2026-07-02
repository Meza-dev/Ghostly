import { useEffect, type ReactNode } from "react";

type Props = {
  onClose: () => void;
  children: ReactNode;
  /** Clases adicionales para el panel (ancho, alto máximo, overflow, etc). */
  className?: string;
};

/**
 * Overlay + panel compartido por los modales de reejecución, espejando el patrón
 * de `new-project-modal.tsx`. Sin lógica de negocio: solo estructura y cierre
 * por backdrop/Escape.
 */
export function ModalShell({ onClose, children, className = "w-[400px]" }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className={`flex flex-col gap-4 rounded-ui border border-border bg-card p-6 shadow-xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
