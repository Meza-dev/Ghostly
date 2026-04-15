import { CirclePlay } from "lucide-react";

type Row = {
  id: string;
  status: "pass" | "fail" | "run";
  suite: string;
  branch: string;
  trigger: string;
  time: string;
  result: string;
  zebra?: boolean;
};

const rows: Row[] = [
  {
    id: "run_8f2a1c",
    status: "pass",
    suite: "e2e · checkout feliz",
    branch: "feat/playwright-flows",
    trigger: "PR #184",
    time: "3m 12s",
    result: "12/12 pasos · sin fallos",
  },
  {
    id: "run_3bb901",
    status: "fail",
    suite: "smoke · API health",
    branch: "main",
    trigger: "cron nightly",
    time: "48s",
    result: "Paso 4/10 · timeout en selector",
    zebra: true,
  },
  {
    id: "run_9ccd21",
    status: "run",
    suite: "regresión · MCP tools",
    branch: "chore/mcp-tools",
    trigger: "manual",
    time: "—",
    result: "Paso 7/24 · captura ARIA…",
  },
];

function StatusBadge({ status }: { status: Row["status"] }) {
  if (status === "pass") {
    return (
      <span className="inline-flex items-center rounded-pill bg-success px-2.5 py-1 text-badge font-badge text-success-fg">
        Pasó
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className="inline-flex items-center rounded-pill bg-error px-2.5 py-1 text-badge font-badge text-error-fg">
        Falló
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-pill bg-warning px-2.5 py-1 text-badge font-badge text-warning-fg">
      Corriendo
    </span>
  );
}

export function RunsPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex shrink-0 items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-button text-muted-fg">Filtrar ejecuciones</span>
          <div className="flex h-[34px] w-[300px] items-center rounded-[6px] border border-border bg-background px-3">
            <span className="text-small text-muted-fg">ID, rama, disparador, flujo…</span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2.5 text-small font-button text-primary-fg hover:opacity-95"
        >
          <CirclePlay className="h-3.5 w-3.5" strokeWidth={2} />
          Nueva corrida
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-ui border border-border bg-card">
        <div
          className="grid shrink-0 border-b border-border bg-muted px-2.5 py-2 text-caption font-button text-muted-fg"
          style={{
            gridTemplateColumns: "108px 96px minmax(0,1fr) 124px 96px 64px minmax(0,1fr)",
          }}
        >
          <span className="px-1.5">Run ID</span>
          <span className="px-1.5 text-center">Estado</span>
          <span className="px-1.5">Flujo / suite</span>
          <span className="px-1.5">Rama Git</span>
          <span className="px-1.5">Disparo</span>
          <span className="px-1.5">Tiempo</span>
          <span className="px-1.5">Resultado</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`grid border-b border-border px-2.5 py-2 text-small ${
                r.zebra ? "bg-muted" : ""
              }`}
              style={{
                gridTemplateColumns: "108px 96px minmax(0,1fr) 124px 96px 64px minmax(0,1fr)",
              }}
            >
              <span className="px-1.5 font-nav-active text-foreground">{r.id}</span>
              <span className="flex justify-center px-1.5">
                <StatusBadge status={r.status} />
              </span>
              <span className="truncate px-1.5 text-foreground">{r.suite}</span>
              <span className="truncate px-1.5 font-nav text-foreground">{r.branch}</span>
              <span className="truncate px-1.5 text-muted-fg">{r.trigger}</span>
              <span className="px-1.5 text-muted-fg">{r.time}</span>
              <span
                className={`truncate px-1.5 font-nav ${
                  r.status === "fail"
                    ? "text-error-fg"
                    : r.status === "run"
                      ? "text-muted-fg"
                      : "text-foreground"
                }`}
              >
                {r.result}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
