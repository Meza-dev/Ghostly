import { useLocation, useNavigate } from "react-router-dom";

export function StatusBar() {
  const navigate = useNavigate();
  const location = useLocation();

  function runQuickAction() {
    if (location.pathname === "/runs") {
      window.dispatchEvent(new CustomEvent("ghostly:new-run"));
    } else if (location.pathname.startsWith("/runs/")) {
      navigate("/runs", { state: { openNewRun: true } });
    } else {
      window.dispatchEvent(new CustomEvent("ghostly:new-project"));
    }
  }

  return (
    <footer className="flex min-h-9 shrink-0 items-center justify-between border-t border-border bg-bg-shell px-6 py-2.5 font-mono text-micro text-muted-fg">
      <div className="flex items-center gap-3">
        <span>runner: ready</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("ghostly:open-command-palette"))}
          className="transition-colors hover:text-foreground"
        >
          Ctrl + Shift + K: buscar
        </button>
        <span>·</span>
        <button type="button" onClick={runQuickAction} className="transition-colors hover:text-foreground">
          Ctrl + Shift + N: nueva ejecución
        </button>
      </div>
    </footer>
  );
}
