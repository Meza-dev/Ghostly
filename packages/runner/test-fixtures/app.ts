/**
 * App fixture del benchmark de fiabilidad (spec §7).
 *
 * Server HTTP mínimo (sin dependencias nuevas) que simula un formulario de
 * "crear nota" con 6 escenarios inyectables vía query param `?scenario=`.
 * Cada escenario reproduce un modo de fallo real observado en producción
 * (ver docs/specs/ghostly-v0.2-trust-release.md §1 y §7).
 *
 * Uso: `startFixtureApp()` levanta el server en un puerto libre y devuelve
 * `{ baseUrl, close }`. Pensado para ser manejado por el benchmark (no CLI).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

export type FixtureScenario =
  | "happy-path"
  | "500-on-save"
  | "validation-reject"
  | "modal-blocking-button"
  | "ephemeral-toast"
  | "non-persisting-save"
  | "app-down";

export type FixtureApp = {
  baseUrl: string;
  close: () => Promise<void>;
};

/** Estado en memoria: notas "persistidas" (simula una base de datos real). */
type Note = { title: string };

const PAGE_STYLES = `
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  .error { color: #b00020; }
  .toast { position: fixed; top: 1rem; right: 1rem; background: #1b5e20; color: #fff; padding: .5rem 1rem; border-radius: 4px; }
  dialog { border: 1px solid #ccc; border-radius: 8px; padding: 1.5rem; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { border: 1px solid #ccc; padding: .25rem .5rem; }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNotesTable(notes: Note[], ghostRowTitle?: string): string {
  if (notes.length === 0 && !ghostRowTitle) return "<p data-testid=\"notes-empty\">Sin notas guardadas.</p>";
  const rows = notes.map((n) => `<tr><td>${escapeHtml(n.title)}</td></tr>`);
  if (ghostRowTitle) {
    // Fila "fantasma": aparece solo en la respuesta inmediata del POST, nunca sobrevive un reload
    // (simula un guardado que PARECE exitoso pero no se persiste — spec causa raíz #4).
    rows.push(`<tr><td>${escapeHtml(ghostRowTitle)}</td></tr>`);
  }
  return `<table data-testid="notes-table"><thead><tr><th>Título</th></tr></thead><tbody>${rows.join("\n")}</tbody></table>`;
}

function renderHomePage(
  notes: Note[],
  scenario: FixtureScenario,
  opts: { toastVisible?: boolean; showModal?: boolean; ghostRowTitle?: string },
): string {
  const toastBlock = opts.toastVisible
    ? `<div class="toast" role="status" data-testid="save-toast">Nota guardada</div>`
    : "";
  const modalBlock = opts.showModal
    ? `<dialog open role="dialog" aria-modal="true" data-testid="confirm-dialog">
        <p>¿Confirmás guardar la nota?</p>
        <button type="button" data-testid="confirm-dialog-ok" onclick="this.closest('dialog').close(); this.closest('dialog').remove();">Aceptar</button>
      </dialog>`
    : "";
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Notas — fixture Ghostly</title><style>${PAGE_STYLES}</style></head>
<body>
  <h1>Notas</h1>
  ${modalBlock}
  <form method="post" action="/save?scenario=${encodeURIComponent(scenario)}" data-testid="note-form">
    <label>
      Título
      <input type="text" name="title" placeholder="Título de la nota" data-testid="note-title-input" />
    </label>
    <button type="submit" data-testid="save-note-button">Guardar</button>
  </form>
  ${toastBlock}
  ${renderNotesTable(notes, opts.ghostRowTitle)}
</body>
</html>`;
}

function renderValidationErrorPage(scenario: FixtureScenario): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Notas — fixture Ghostly</title><style>${PAGE_STYLES}</style></head>
<body>
  <h1>Notas</h1>
  <p class="error" role="alert" data-testid="validation-error">El título es obligatorio.</p>
  <form method="post" action="/save?scenario=${encodeURIComponent(scenario)}" data-testid="note-form">
    <label>
      Título
      <input type="text" name="title" placeholder="Título de la nota" data-testid="note-title-input" />
    </label>
    <button type="submit" data-testid="save-note-button">Guardar</button>
  </form>
  ${renderNotesTable([])}
</body>
</html>`;
}

function renderServerErrorPage(): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Error — fixture Ghostly</title><style>${PAGE_STYLES}</style></head>
<body>
  <h1 class="error" role="alert" data-testid="server-error-banner">Error interno del servidor (500)</h1>
  <p>No se pudo guardar la nota. Intentá de nuevo más tarde.</p>
</body>
</html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseFormTitle(body: string): string {
  const params = new URLSearchParams(body);
  return (params.get("title") ?? "").trim();
}

/**
 * Levanta la app fixture en un puerto libre local.
 * `notesPersist: false` (default true) simula guardado no persistente:
 * el POST responde 200 pero la nota nunca queda en el store real.
 */
export function startFixtureApp(): Promise<FixtureApp> {
  const notes: Note[] = [];

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const scenario = (url.searchParams.get("scenario") as FixtureScenario | null) ?? "happy-path";

      if (scenario === "app-down") {
        // Simula la app completamente caída: conexión rechazada.
        req.socket.destroy();
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const showModal = scenario === "modal-blocking-button";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHomePage(notes, scenario, { showModal }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/save") {
        const body = await readBody(req);
        const title = parseFormTitle(body);

        if (scenario === "500-on-save") {
          res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
          res.end(renderServerErrorPage());
          return;
        }

        if (scenario === "validation-reject") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(renderValidationErrorPage(scenario));
          return;
        }

        if (scenario === "non-persisting-save") {
          // Responde éxito (toast + fila fantasma con el título) pero NO agrega la nota al
          // store real: un reload no la muestra. Atrapa al agente que confía en la respuesta
          // inmediata sin re-verificar tras recargar (spec AC3).
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(renderHomePage(notes, scenario, { toastVisible: true, ghostRowTitle: title || undefined }));
          return;
        }

        if (scenario === "ephemeral-toast") {
          // Persiste de verdad, pero el toast solo aparece en la respuesta inmediata del POST
          // (un reload no lo muestra) — simula un mensaje de éxito que desaparece rápido.
          if (title) notes.push({ title });
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(renderHomePage(notes, scenario, { toastVisible: true }));
          return;
        }

        // happy-path / modal-blocking-button: guardado real y persistente.
        if (title) notes.push({ title });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHomePage(notes, scenario, { toastVisible: true }));
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`fixture app error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no se pudo resolver el puerto del fixture app"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res2) => server.close(() => res2())),
      });
    });
  });
}
