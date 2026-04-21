import { useEffect, useRef, useState } from "react";
import type { AssistEvent } from "../components/assist-timeline";
import { getToken } from "../lib/api";

export type RunStatus = "running" | "pass" | "fail";

export type StreamedEvent = AssistEvent;

export type RunStreamState = {
  events: StreamedEvent[];
  status: RunStatus;
  connected: boolean;
  /** true cuando el backend publicó `end` y cerraremos la conexión. */
  finished: boolean;
};

/**
 * Abre un EventSource contra /v1/runs/:id/events/stream y expone los eventos
 * en tiempo real. Si el run ya terminó, recibe el catch-up completo y cierra.
 */
export function useRunStream(
  runId: string | undefined,
  initialStatus: RunStatus = "running",
): RunStreamState {
  const [events, setEvents] = useState<StreamedEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const seenSeqs = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!runId) return;
    const token = getToken();
    if (!token) return;

    seenSeqs.current = new Set();
    setEvents([]);
    setFinished(false);

    const url = `/v1/runs/${runId}/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));

    es.addEventListener("status", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as {
          status: RunStatus;
        };
        setStatus(data.status);
      } catch {
        // ignore
      }
    });

    es.addEventListener("assist", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as AssistEvent & {
          kind: "assist";
        };
        if (typeof data.seq === "number" && seenSeqs.current.has(data.seq)) {
          return;
        }
        if (typeof data.seq === "number") seenSeqs.current.add(data.seq);
        const evt: AssistEvent = {
          seq: data.seq,
          type: data.type,
          at: data.at,
          payload: data.payload,
          ...(typeof data.stepIndex === "number" ? { stepIndex: data.stepIndex } : {}),
        };
        setEvents((prev) => {
          const next = [...prev, evt];
          next.sort((a, b) => a.seq - b.seq);
          return next;
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener("end", () => {
      setFinished(true);
      es.close();
    });

    return () => {
      esRef.current = null;
      es.close();
    };
  }, [runId]);

  return { events, status, connected, finished };
}
