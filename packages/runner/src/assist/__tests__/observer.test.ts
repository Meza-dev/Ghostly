import { describe, expect, it, vi } from "vitest";
import { captureObserverSnapshot, createPageErrorTracker } from "../observer.js";

type ConsoleHandler = (msg: FakeConsoleMessage) => void;
type PageErrorHandler = (err: Error) => void;
type ResponseHandler = (res: FakeResponse) => void;

type FakeConsoleMessage = {
  type: () => string;
  text: () => string;
};

type FakeResponse = {
  status: () => number;
  url: () => string;
  request: () => { method: () => string };
};

type FakePage = {
  url: () => string;
  title: () => Promise<string>;
  locator: (sel: string) => { ariaSnapshot: (opts: unknown) => Promise<string> };
  waitForLoadState: (state: string, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  on: (event: string, handler: ConsoleHandler | PageErrorHandler | ResponseHandler) => FakePage;
};

function buildFakePage(
  markdown: string,
  opts: { url?: string; title?: string; domResult?: unknown } = {},
): FakePage & { emitConsole: ConsoleHandler; emitPageError: PageErrorHandler; emitResponse: ResponseHandler } {
  const { url = "https://ex.com/", title = "Home", domResult = [] } = opts;
  const handlers: Record<string, Array<ConsoleHandler | PageErrorHandler | ResponseHandler>> = {};
  const page: FakePage & {
    emitConsole: ConsoleHandler;
    emitPageError: PageErrorHandler;
    emitResponse: ResponseHandler;
  } = {
    url: () => url,
    title: async () => title,
    locator: () => ({
      ariaSnapshot: async () => markdown,
    }),
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async () => domResult as never,
    on: (event, handler) => {
      (handlers[event] ??= []).push(handler);
      return page;
    },
    emitConsole: (msg) => {
      for (const h of handlers.console ?? []) (h as ConsoleHandler)(msg);
    },
    emitPageError: (err) => {
      for (const h of handlers.pageerror ?? []) (h as PageErrorHandler)(err);
    },
    emitResponse: (res) => {
      for (const h of handlers.response ?? []) (h as ResponseHandler)(res);
    },
  };
  return page;
}

describe("captureObserverSnapshot", () => {
  it("devuelve snapshot con nodeCount basado en líneas '- '", async () => {
    const md = [
      "- button \"Entrar\"",
      "- textbox \"email\"",
      "  - link \"olvidé\"",
    ].join("\n");
    const page = buildFakePage(md);
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.nodeCount).toBe(3);
    expect(snap.url).toBe("https://ex.com/");
    expect(snap.title).toBe("Home");
    expect(snap.treeMarkdown).toContain("button");
  });

  it("devuelve placeholder si ariaSnapshot está vacío", async () => {
    const page = buildFakePage("");
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.nodeCount).toBe(0);
    expect(snap.treeMarkdown).toContain("sin mapa");
  });

  it("no falla si title() lanza", async () => {
    const page: FakePage = {
      url: () => "https://e.com/",
      title: () => Promise.reject(new Error("boom")),
      locator: () => ({ ariaSnapshot: async () => "- button \"x\"" }),
      waitForLoadState: async () => undefined,
      waitForTimeout: async () => undefined,
      evaluate: async () => [] as never,
      on: () => page as unknown as FakePage,
    };
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.title).toBe("");
    expect(snap.nodeCount).toBe(1);
  });

  it("respeta límite maxNodes (aprox)", async () => {
    const md = Array.from({ length: 20 }, (_, i) => `- button "b${i}"`).join("\n");
    const page = buildFakePage(md);
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 5);
    expect(snap.nodeCount).toBeLessThanOrEqual(20);
    expect(snap.treeMarkdown.split("\n").length).toBeLessThanOrEqual(20);
  });

  it("devuelve pageErrors vacío cuando no hay tracker ni errores DOM", async () => {
    const page = buildFakePage("- button \"x\"");
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.pageErrors).toEqual([]);
  });

  it("detecta role=alert visible en el DOM como blocking", async () => {
    const page = buildFakePage("- button \"x\"", {
      domResult: [{ role: "alert", text: "Error al guardar el registro", selector: '[role="alert"]' }],
    });
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.pageErrors).toHaveLength(1);
    expect(snap.pageErrors[0]).toMatchObject({
      source: "dom",
      severity: "blocking",
      message: "Error al guardar el registro",
    });
  });

  it("detecta aria-live=assertive como warning cuando el texto no matchea patrones de error", async () => {
    const page = buildFakePage("- button \"x\"", {
      domResult: [{ role: "status", text: "Guardado correctamente", selector: '[aria-live="assertive"]' }],
    });
    const snap = await captureObserverSnapshot(page as unknown as Parameters<typeof captureObserverSnapshot>[0], 100);
    expect(snap.pageErrors).toHaveLength(1);
    expect(snap.pageErrors[0]?.severity).toBe("warning");
  });
});

describe("createPageErrorTracker", () => {
  it("captura errores de consola tipo=error", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitConsole({ type: () => "error", text: () => "TypeError: cannot read x" });
    page.emitConsole({ type: () => "warning", text: () => "deprecated api" });
    const errors = tracker.collectForStep(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "console", severity: "warning" });
    expect(errors[0]?.message).toContain("TypeError");
  });

  it("captura excepciones no atrapadas (pageerror) como blocking", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitPageError(new Error("Uncaught crash"));
    const errors = tracker.collectForStep(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "console", severity: "blocking" });
    expect(errors[0]?.message).toContain("Uncaught crash");
  });

  it("captura respuestas >=400 same-origin con método/URL/status", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitResponse({
      status: () => 500,
      url: () => "https://ex.com/api/save",
      request: () => ({ method: () => "POST" }),
    });
    const errors = tracker.collectForStep(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "network", severity: "blocking" });
    expect(errors[0]?.detail).toMatchObject({ url: "https://ex.com/api/save", status: 500 });
  });

  it("clasifica 4xx como warning, no blocking", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitResponse({
      status: () => 404,
      url: () => "https://ex.com/api/missing",
      request: () => ({ method: () => "GET" }),
    });
    const errors = tracker.collectForStep(0);
    expect(errors[0]?.severity).toBe("warning");
  });

  it("ignora respuestas de dominios de terceros fuera del allowlist del baseUrl", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitResponse({
      status: () => 500,
      url: () => "https://analytics.thirdparty.com/collect",
      request: () => ({ method: () => "POST" }),
    });
    const errors = tracker.collectForStep(0);
    expect(errors).toHaveLength(0);
  });

  it("redacta secretos en la URL de network errors (token/apikey en query string)", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitResponse({
      status: () => 401,
      url: () => "https://ex.com/api/login?token=abc123secret&user=me",
      request: () => ({ method: () => "GET" }),
    });
    const errors = tracker.collectForStep(0);
    expect(errors[0]?.detail?.url).not.toContain("abc123secret");
    expect(errors[0]?.detail?.url).toMatch(/token=(%5BREDACTED%5D|\[REDACTED\])/);
  });

  it("ventana móvil: descarta errores de pasos anteriores al collectForStep actual", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitConsole({ type: () => "error", text: () => "first" });
    tracker.collectForStep(0);
    page.emitConsole({ type: () => "error", text: () => "second" });
    const errors = tracker.collectForStep(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("second");
  });

  it("marca observedAtStep con el índice de paso pasado a collectForStep", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    page.emitConsole({ type: () => "error", text: () => "boom" });
    const errors = tracker.collectForStep(3);
    expect(errors[0]?.observedAtStep).toBe(3);
  });

  it("getHistory acumula todos los errores del run aunque la ventana móvil se vacíe", () => {
    const page = buildFakePage("- button \"x\"");
    const tracker = createPageErrorTracker(page as unknown as Parameters<typeof createPageErrorTracker>[0], {
      baseUrl: "https://ex.com",
    });
    // Paso 7: la app rechaza el guardado con 500 (evidencia crítica).
    page.emitResponse({
      status: () => 500,
      url: () => "https://ex.com/api/clientes",
      request: () => ({ method: () => "POST" }),
    });
    tracker.collectForStep(7);
    // Pasos posteriores sin errores nuevos: la ventana móvil del paso 9 va vacía…
    expect(tracker.collectForStep(9)).toHaveLength(0);
    // …pero el historial acumulado del run conserva el 500 del paso 7 con su índice.
    const history = tracker.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "network", severity: "blocking", observedAtStep: 7 });
  });
});

// Silenciar warning si vitest tuviera hooks globales
vi.stubGlobal("__vitestSilencer__", true);
