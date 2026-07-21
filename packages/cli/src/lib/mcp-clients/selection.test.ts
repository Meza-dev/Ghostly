import { describe, expect, it } from "vitest";
import { resolveSelectedClients } from "./selection.js";
import type { McpClient } from "./types.js";

function stubClient(id: string, supported: boolean): McpClient {
  return {
    id: id as McpClient["id"],
    label: id,
    supported,
    detect: () => true,
    isConfigured: () => false,
    inject: () => ({ status: supported ? "injected" : "unsupported" }),
  };
}

const cursor = stubClient("cursor", true);
const claudeDesktop = stubClient("claude-desktop", false);

const detected = [
  { client: cursor, installed: true },
  { client: claudeDesktop, installed: true },
];

describe("resolveSelectedClients", () => {
  it("selects supported clients requested by id", () => {
    const { selected, warnings } = resolveSelectedClients(detected, ["cursor"]);
    expect(selected).toEqual([cursor]);
    expect(warnings).toEqual([]);
  });

  it("warns and skips unknown ids", () => {
    const { selected, warnings } = resolveSelectedClients(detected, ["ghost-client"]);
    expect(selected).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown/i);
  });

  it("warns and skips detect-only (unsupported) ids", () => {
    const { selected, warnings } = resolveSelectedClients(detected, ["claude-desktop"]);
    expect(selected).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not supported yet/i);
  });

  it("returns an empty selection for an empty id list", () => {
    expect(resolveSelectedClients(detected, [])).toEqual({ selected: [], warnings: [] });
  });

  it("dedupes repeated ids so a client is only injected once", () => {
    const { selected } = resolveSelectedClients(detected, ["cursor", "cursor"]);
    expect(selected).toEqual([cursor]);
  });

  it("is case-insensitive and trims whitespace", () => {
    const { selected, warnings } = resolveSelectedClients(detected, [" Cursor "]);
    expect(selected).toEqual([cursor]);
    expect(warnings).toEqual([]);
  });
});
