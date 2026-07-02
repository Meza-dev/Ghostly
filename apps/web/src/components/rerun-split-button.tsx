import { ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  disabled: boolean;
  rerunning: boolean;
  canChangeData: boolean;
  canAddInstructions: boolean;
  onRerunSame: () => void;
  onChangeData: () => void;
  onAddInstructions: () => void;
};

type MenuItem = {
  key: string;
  label: string;
  enabled: boolean;
  title?: string;
  onSelect: () => void;
};

/**
 * Botón primario "Reejecutar igual" + caret con menú de tres opciones. Cada
 * acción se habilita/deshabilita de forma independiente según su propia
 * precondición, con tooltip explicativo cuando está deshabilitada. Operable
 * por teclado: flechas para navegar el menú, Enter/Espacio para activar,
 * Escape para cerrar sin disparar ninguna acción.
 */
export function RerunSplitButton({
  disabled,
  rerunning,
  canChangeData,
  canAddInstructions,
  onRerunSame,
  onChangeData,
  onAddInstructions,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items: MenuItem[] = [
    { key: "same", label: "Reejecutar igual", enabled: true, onSelect: onRerunSame },
    {
      key: "data",
      label: "Cambiar datos…",
      enabled: canChangeData,
      title: canChangeData ? undefined : "Este run no tiene campos de datos editables.",
      onSelect: onChangeData,
    },
    {
      key: "instructions",
      label: "Añadir instrucciones…",
      enabled: canAddInstructions,
      title: canAddInstructions
        ? undefined
        : "Este run no es asistido; no hay objetivo al que añadir instrucciones.",
      onSelect: onAddInstructions,
    },
  ];

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const focusable = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
      if (focusable.length === 0) return;
      const currentIndex = focusable.findIndex((el) => el === document.activeElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + delta + focusable.length) % focusable.length;
      focusable[nextIndex]?.focus();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) itemRefs.current[0]?.focus();
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onRerunSame}
        disabled={disabled || rerunning}
        className="inline-flex items-center gap-1.5 rounded-l-control-sm border border-r-0 border-border bg-muted px-3 py-1.5 text-small font-button text-primary-fg hover:bg-bg-muted disabled:opacity-60"
      >
        {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        {rerunning ? "Reejecutando..." : "Reejecutar"}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={disabled || rerunning}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Más opciones de reejecución"
        className="inline-flex items-center justify-center rounded-r-control-sm border border-border bg-muted px-2 py-1.5 text-primary-fg hover:bg-bg-muted disabled:opacity-60"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-control-md border border-border bg-card shadow-xl"
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              disabled={!item.enabled}
              title={item.title}
              onClick={() => {
                if (!item.enabled) return;
                setMenuOpen(false);
                item.onSelect();
              }}
              className="block w-full px-3 py-2 text-left text-small text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-fg disabled:opacity-60"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
