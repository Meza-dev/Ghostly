import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InjectResult, McpClient, McpEntry } from "./types.js";

let mcpServerEntryPath: string;
let confirmAnswer: boolean | symbol = true;

vi.mock("../paths.js", () => ({
  getMcpServerEntryPath: () => mcpServerEntryPath,
}));

vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  confirm: async () => confirmAnswer,
  isCancel: (v: unknown) => typeof v === "symbol",
}));

const { configureClient } = await import("./configure.js");
const p = await import("@clack/prompts");

const entry: McpEntry = {
  command: "node",
  args: ["/abs/index.js"],
  env: { GHOST_API_KEY: "k", GHOST_API_URL: "u" },
};

function makeClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    id: "cursor",
    label: "Test Client",
    supported: true,
    restartHint: "restart Test Client",
    detect: () => true,
    isConfigured: vi.fn(() => false),
    inject: vi.fn((): InjectResult => ({ status: "injected" })),
    installGuidance: vi.fn(),
    ...overrides,
  };
}

describe("configureClient", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ghostly-configure-test-"));
    mcpServerEntryPath = join(dir, "mcp-server-index.js");
    writeFileSync(mcpServerEntryPath, "// stub");
    confirmAnswer = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("injects and runs installGuidance on a fresh (not-yet-configured) client", async () => {
    const client = makeClient();

    const result = await configureClient(client, entry);

    expect(result.status).toBe("injected");
    expect(client.inject).toHaveBeenCalledWith(entry);
    expect(client.installGuidance).toHaveBeenCalled();
  });

  it("prints the client's restartHint after a successful inject", async () => {
    const client = makeClient({ restartHint: "quit and reopen Test Client" });

    await configureClient(client, entry);

    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("quit and reopen Test Client"));
  });

  it("falls back to a generic restart hint when the client doesn't define one", async () => {
    const client = makeClient({ restartHint: undefined });

    await configureClient(client, entry);

    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("Test Client"));
  });

  it("asks to overwrite when already configured; skips inject if declined", async () => {
    confirmAnswer = false;
    const client = makeClient({ isConfigured: vi.fn(() => true) });

    const result = await configureClient(client, entry);

    expect(client.inject).not.toHaveBeenCalled();
    expect(result.status).toBe("already");
  });

  it("injects when already configured and user confirms overwrite", async () => {
    confirmAnswer = true;
    const client = makeClient({ isConfigured: vi.fn(() => true) });

    await configureClient(client, entry);

    expect(client.inject).toHaveBeenCalledWith(entry);
  });

  it("does not call installGuidance when inject result is skipped-backup", async () => {
    const client = makeClient({
      inject: vi.fn((): InjectResult => ({ status: "skipped-backup", detail: "x" })),
    });

    await configureClient(client, entry);

    expect(client.installGuidance).not.toHaveBeenCalled();
  });
});
