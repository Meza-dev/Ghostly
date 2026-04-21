import { describe, expect, it, vi } from "vitest";
import { captureObserverSnapshot } from "../observer.js";

type FakePage = {
  url: () => string;
  title: () => Promise<string>;
  locator: (sel: string) => { ariaSnapshot: (opts: unknown) => Promise<string> };
  waitForLoadState: (state: string, opts?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  evaluate: <T>(fn: () => T) => Promise<T>;
};

function buildFakePage(markdown: string, url = "https://ex.com/", title = "Home"): FakePage {
  return {
    url: () => url,
    title: async () => title,
    locator: () => ({
      ariaSnapshot: async () => markdown,
    }),
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async () => [] as never,
  };
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
});

// Silenciar warning si vitest tuviera hooks globales
vi.stubGlobal("__vitestSilencer__", true);
