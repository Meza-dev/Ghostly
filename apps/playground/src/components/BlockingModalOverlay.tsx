import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * When the "blocking-modal" fail-mode is on, this overlay covers the main
 * actions until the user explicitly closes it. Useful to test how Ghostly
 * handles unexpected blocking UI.
 */
export function BlockingModalOverlay() {
  const [blocking, setBlocking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const config = await api.getConfig();
        if (!cancelled) setBlocking(config.blockingModal);
      } catch {
        // ignore
      }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (blocking) setDismissed(false);
  }, [blocking]);

  if (!blocking || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div
        data-testid="blocking-modal-overlay"
        className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-xl"
      >
        <h2 className="mb-2 text-lg font-semibold text-gray-800">Modal bloqueante activo</h2>
        <p className="mb-4 text-sm text-gray-600">
          El modo de falla "blocking-modal" está activo. Este modal tapa las acciones principales
          hasta que lo cierres.
        </p>
        <button
          type="button"
          data-testid="blocking-modal-close"
          onClick={() => setDismissed(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
