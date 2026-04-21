import { EventEmitter } from "node:events";

/**
 * Evento normalizado publicado en el bus en vivo de una corrida.
 * Se usa tanto para SSE como (potencialmente) para logs internos.
 */
export type LiveRunEvent =
  | {
      kind: "assist";
      type: string;
      seq: number;
      at: string;
      stepIndex?: number;
      payload: Record<string, unknown>;
    }
  | {
      kind: "status";
      status: "running" | "pass" | "fail";
      at: string;
    }
  | {
      kind: "end";
      at: string;
    };

type Handler = (event: LiveRunEvent) => void;

/**
 * Bus in-memory de eventos por runId. Diseñado para una sola instancia de API
 * (suficiente para dev local y despliegues de un solo proceso). Para clustering
 * habría que cambiar a Redis pub/sub o similar.
 */
class RunEventBus {
  private emitters = new Map<string, EventEmitter>();

  /** Publica un evento para un runId concreto. */
  publish(runId: string, event: LiveRunEvent): void {
    const em = this.emitters.get(runId);
    if (em) em.emit("event", event);
  }

  /**
   * Suscribe un handler al runId. Si no existe emitter aún, lo crea
   * (el publisher lo reutiliza). Devuelve función para cancelar.
   */
  subscribe(runId: string, handler: Handler): () => void {
    let em = this.emitters.get(runId);
    if (!em) {
      em = new EventEmitter();
      em.setMaxListeners(32);
      this.emitters.set(runId, em);
    }
    em.on("event", handler);
    return () => {
      em!.off("event", handler);
    };
  }

  /**
   * Marca el fin del stream: publica evento `end` y limpia listeners diferidamente.
   * Los suscriptores deberán cerrar su respuesta HTTP al recibir `end`.
   */
  close(runId: string): void {
    const em = this.emitters.get(runId);
    if (!em) return;
    em.emit("event", { kind: "end", at: new Date().toISOString() });
    setTimeout(() => {
      em.removeAllListeners();
      this.emitters.delete(runId);
    }, 5_000);
  }

  /** Indica si hay un emisor activo (la corrida está en vivo). */
  isActive(runId: string): boolean {
    return this.emitters.has(runId);
  }
}

export const runEventBus = new RunEventBus();
