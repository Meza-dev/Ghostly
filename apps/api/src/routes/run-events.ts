import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware } from "../middleware/auth.js";
import { runEventBus, type LiveRunEvent } from "../services/run-event-bus.js";
import { getRun } from "../store/runs.js";
import { msg, pickLang } from "../i18n/pick.js";

export const runEventsRouter = new Hono();

runEventsRouter.use("/runs/:id/events/stream", authMiddleware);

/**
 * SSE endpoint que emite eventos de una corrida en tiempo real.
 * - Catch-up: al conectar envía el estado actual y los AssistEvents ya persistidos.
 * - Live: si el run está corriendo, se suscribe al bus y reenvía eventos nuevos.
 * - Cierre: al recibir `end` o status final (pass/fail), cierra el stream.
 */
runEventsRouter.get("/runs/:id/events/stream", async (c) => {
  const lang = pickLang(c.req.header("Accept-Language"));
  const user = c.get("user");
  const id = c.req.param("id");

  const run = await getRun(id, user.id);
  if (!run) {
    return c.json({ ok: false, error: msg("run.notFound", lang) }, 404);
  }

  return streamSSE(c, async (stream) => {
    let seqCounter = 0;
    const send = async (event: LiveRunEvent) => {
      seqCounter += 1;
      await stream.writeSSE({
        id: String(seqCounter),
        event: event.kind,
        data: JSON.stringify(event),
      });
    };

    // 1) Estado actual como primer mensaje (running/pass/fail).
    await send({
      kind: "status",
      status: run.status,
      at: new Date().toISOString(),
    });

    // 2) Catch-up: reenvía eventos ya persistidos para que el cliente tenga historial.
    const existing = run.events ?? [];
    for (const ev of existing) {
      await send({
        kind: "assist",
        type: ev.type,
        seq: ev.seq,
        at: ev.at,
        ...(ev.stepIndex !== undefined ? { stepIndex: ev.stepIndex } : {}),
        payload: ev.payload,
      });
    }

    // 3) Si ya terminó, cerramos.
    if (run.status !== "running") {
      await send({ kind: "end", at: new Date().toISOString() });
      return;
    }

    // 4) Live: suscribirse al bus y reenviar eventos.
    let finished = false;
    const closed = new Promise<void>((resolve) => {
      const unsubscribe = runEventBus.subscribe(id, (event) => {
        void send(event).catch(() => {
          finished = true;
          unsubscribe();
          resolve();
        });
        if (event.kind === "end") {
          finished = true;
          unsubscribe();
          resolve();
        }
      });

      // Cierre por desconexión del cliente.
      stream.onAbort(() => {
        if (!finished) {
          finished = true;
          unsubscribe();
          resolve();
        }
      });
    });

    // Heartbeat cada 15s para mantener viva la conexión (y detectar desconexión).
    const heartbeat = setInterval(() => {
      if (finished) {
        clearInterval(heartbeat);
        return;
      }
      void stream
        .writeSSE({ event: "ping", data: String(Date.now()) })
        .catch(() => {
          finished = true;
          clearInterval(heartbeat);
        });
    }, 15_000);

    await closed;
    clearInterval(heartbeat);
  });
});
