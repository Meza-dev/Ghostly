/**
 * El juez — contrato, dossier builder, cap de `continue` (Capa 3, spec §4.3) — RED baseline.
 *
 * Fase 3a, Kanon GHOST-29: este archivo prueba, aisladas del loop de Playwright,
 * las piezas puras del contrato del juez: el schema Zod de `JudgeVerdict`, el
 * dossier builder (`buildJudgeDossier`) y el contador de intervenciones
 * `continue` por motivo (`JudgeContinueCapTracker`). La invocación real del LLM
 * (`deps.judge`) y el wiring en `pipeline.ts` se prueban vía la suite del
 * benchmark de fiabilidad con un juez de test (oráculo determinista).
 */
import { describe, expect, it } from "vitest";
import {
  buildJudgeDossier,
  createJudgeContinueCapTracker,
  judgeVerdictSchema,
  MAX_CONTINUE_VERDICTS_PER_REASON,
  validateJudgeVerdict,
} from "../judge.js";
import type { Step } from "../../schema.js";
import type { JudgeDossier, ObserverSnapshot, PageError } from "../types.js";

function snapshot(overrides: Partial<ObserverSnapshot> = {}): ObserverSnapshot {
  return {
    url: "https://example.test/notes",
    title: "Notas",
    capturedAt: new Date().toISOString(),
    treeMarkdown: "- heading: Notas",
    nodeCount: 1,
    pageErrors: [],
    ...overrides,
  };
}

function step(action: Step["action"] = "click"): Step {
  if (action === "click") return { action: "click", selector: '[data-testid="save-note-button"]' };
  if (action === "fill") {
    return { action: "fill", selector: '[data-testid="note-title-input"]', value: "Reunión" };
  }
  return { action: "snapshot" };
}

describe("judgeVerdictSchema (spec 4.3 — contrato estricto del juez)", () => {
  it("accepts a minimal valid 'continue' verdict with a hint", () => {
    const parsed = judgeVerdictSchema.safeParse({
      verdict: "continue",
      confidence: "high",
      reasoning: "Hay un modal de confirmación tapando el botón; cerralo primero.",
      evidence: ["dialog role=alertdialog visible"],
      hint: "cerrá el modal de confirmación antes de guardar",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a terminal verdict without a hint", () => {
    const parsed = judgeVerdictSchema.safeParse({
      verdict: "fail-app-bug",
      confidence: "medium",
      reasoning: "La respuesta del guardado fue un 500.",
      evidence: ["POST /save -> 500"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown verdict value", () => {
    const parsed = judgeVerdictSchema.safeParse({
      verdict: "success-ish",
      confidence: "high",
      reasoning: "x",
      evidence: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing reasoning field", () => {
    const parsed = judgeVerdictSchema.safeParse({
      verdict: "success",
      confidence: "high",
      evidence: ["text visible"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid confidence value", () => {
    const parsed = judgeVerdictSchema.safeParse({
      verdict: "inconclusive",
      confidence: "certain",
      reasoning: "x",
      evidence: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts all 6 taxonomy verdicts", () => {
    const verdicts = [
      "continue",
      "success",
      "fail-app-bug",
      "fail-test-broken",
      "fail-agent-lost",
      "inconclusive-environment",
      "inconclusive",
    ];
    for (const verdict of verdicts) {
      const parsed = judgeVerdictSchema.safeParse({
        verdict,
        confidence: "low",
        reasoning: "x",
        evidence: [],
      });
      expect(parsed.success).toBe(true);
    }
  });
});

describe("validateJudgeVerdict (retry-once-then-inconclusive, mismo patrón que el healer)", () => {
  it("returns the parsed verdict on the first well-formed attempt", async () => {
    let calls = 0;
    const result = await validateJudgeVerdict(async () => {
      calls++;
      return {
        verdict: "success" as const,
        confidence: "high" as const,
        reasoning: "El texto persiste tras recargar.",
        evidence: ["textIncludes matched"],
      };
    });
    expect(calls).toBe(1);
    expect(result.verdict).toBe("success");
  });

  it("retries once on malformed output and accepts the second attempt if valid", async () => {
    let calls = 0;
    const result = await validateJudgeVerdict(async () => {
      calls++;
      if (calls === 1) return { verdict: "not-a-real-verdict" };
      return {
        verdict: "inconclusive" as const,
        confidence: "low" as const,
        reasoning: "Evidencia insuficiente.",
        evidence: [],
      };
    });
    expect(calls).toBe(2);
    expect(result.verdict).toBe("inconclusive");
  });

  it("falls back to inconclusive with a judge-failure note after two malformed attempts", async () => {
    let calls = 0;
    const result = await validateJudgeVerdict(async () => {
      calls++;
      return { verdict: "not-a-real-verdict", garbage: true };
    });
    expect(calls).toBe(2);
    expect(result.verdict).toBe("inconclusive");
    expect(result.confidence).toBe("low");
    expect(result.reasoning).toMatch(/juez|malformado|inválid/i);
  });

  it("also retries when the judge callback throws instead of returning malformed data", async () => {
    let calls = 0;
    const result = await validateJudgeVerdict(async () => {
      calls++;
      if (calls === 1) throw new Error("LLM timeout");
      return {
        verdict: "continue" as const,
        confidence: "medium" as const,
        reasoning: "Reintentó tras timeout.",
        evidence: [],
      };
    });
    expect(calls).toBe(2);
    expect(result.verdict).toBe("continue");
  });
});

describe("createJudgeContinueCapTracker (spec 4.3 regla 5 — máx 2 continue por motivo)", () => {
  it("allows up to MAX_CONTINUE_VERDICTS_PER_REASON continue verdicts for the same reason", () => {
    const tracker = createJudgeContinueCapTracker();
    expect(tracker.canContinue("victory-candidate")).toBe(true);
    tracker.recordContinue("victory-candidate");
    expect(tracker.canContinue("victory-candidate")).toBe(true);
    tracker.recordContinue("victory-candidate");
    // 3rd invocation for the SAME reason must force a terminal verdict.
    expect(tracker.canContinue("victory-candidate")).toBe(false);
  });

  it("MAX_CONTINUE_VERDICTS_PER_REASON is exactly 2 per spec", () => {
    expect(MAX_CONTINUE_VERDICTS_PER_REASON).toBe(2);
  });

  it("tracks caps independently per trigger reason", () => {
    const tracker = createJudgeContinueCapTracker();
    tracker.recordContinue("stalled");
    tracker.recordContinue("stalled");
    expect(tracker.canContinue("stalled")).toBe(false);
    // A different reason has its own independent budget.
    expect(tracker.canContinue("error-signal")).toBe(true);
  });
});

describe("buildJudgeDossier (spec 4.3 — el dossier, input del juez)", () => {
  it("assembles goal, victoryCondition, reason, and the current/previous snapshots into a dossier", () => {
    const dossier = buildJudgeDossier({
      goal: "Crear una nota con título 'Reunión de equipo'",
      victoryCondition: { textIncludes: ["Reunión de equipo"], mustAll: true },
      reason: "victory-candidate",
      history: [{ step: step("fill"), ok: true }, { step: step("click"), ok: true }],
      currentSnapshot: snapshot({ url: "https://example.test/notes?saved=1" }),
      previousSnapshot: snapshot(),
      pageErrors: [],
      deterministicChecks: [{ check: "victory.textIncludes('Reunión de equipo')", passed: false }],
    });
    expect(dossier.goal).toBe("Crear una nota con título 'Reunión de equipo'");
    expect(dossier.reason).toBe("victory-candidate");
    expect(dossier.victoryCondition).toEqual({ textIncludes: ["Reunión de equipo"], mustAll: true });
    expect(dossier.deterministicChecks).toEqual([
      { check: "victory.textIncludes('Reunión de equipo')", passed: false },
    ]);
  });

  it("caps recentActions to the last 8 entries per spec (default N=8)", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      step: { action: "click" as const, selector: `[data-testid="step-${i}"]` },
      ok: true,
    }));
    const dossier = buildJudgeDossier({
      goal: "goal",
      reason: "stalled",
      history,
      currentSnapshot: snapshot(),
      pageErrors: [],
      deterministicChecks: [],
    });
    expect(dossier.recentActions).toHaveLength(8);
    expect(dossier.recentActions.at(-1)!.step).toContain("step-11");
  });

  it("maps history outcome to ok/failed/healed and includes the error message when present", () => {
    const dossier = buildJudgeDossier({
      goal: "goal",
      reason: "healing-exhausted",
      history: [
        { step: step("click"), ok: true },
        { step: step("click"), ok: false, error: "selector not found" },
      ],
      currentSnapshot: snapshot(),
      pageErrors: [],
      deterministicChecks: [],
    });
    expect(dossier.recentActions[0]!.outcome).toBe("ok");
    expect(dossier.recentActions[1]!.outcome).toBe("failed");
    expect(dossier.recentActions[1]!.error).toBe("selector not found");
  });

  it("computes a non-empty snapshotDiff string when the previous and current snapshots differ", () => {
    const dossier = buildJudgeDossier({
      goal: "goal",
      reason: "victory-candidate",
      history: [],
      previousSnapshot: snapshot({ url: "https://example.test/notes" }),
      currentSnapshot: snapshot({ url: "https://example.test/notes?saved=1" }),
      pageErrors: [],
      deterministicChecks: [],
    });
    expect(dossier.snapshotDiff.length).toBeGreaterThan(0);
    expect(dossier.snapshotDiff).not.toBe("(sin snapshot previo)");
  });

  it("reports an explicit 'no previous snapshot' diff placeholder when there is none (e.g. first-step trigger)", () => {
    const dossier = buildJudgeDossier({
      goal: "goal",
      reason: "error-signal",
      history: [],
      currentSnapshot: snapshot(),
      pageErrors: [],
      deterministicChecks: [],
    });
    expect(dossier.snapshotDiff).toBe("(sin snapshot previo)");
  });

  it("passes pageErrors through untouched (already sanitized upstream by the observer)", () => {
    const pageErrors: PageError[] = [
      { source: "network", severity: "warning", message: "GET /notes -> 404", observedAtStep: 1 },
    ];
    const dossier = buildJudgeDossier({
      goal: "goal",
      reason: "error-signal",
      history: [],
      currentSnapshot: snapshot(),
      pageErrors,
      deterministicChecks: [],
    });
    expect(dossier.pageErrors).toEqual(pageErrors);
  });

  it("does not include a screenshot field (runner never attaches images — provider-gating is API-side/GHOST-30)", () => {
    const dossier: JudgeDossier = buildJudgeDossier({
      goal: "goal",
      reason: "budget-exhausted",
      history: [],
      currentSnapshot: snapshot(),
      pageErrors: [],
      deterministicChecks: [],
    });
    expect(dossier.screenshot).toBeUndefined();
  });
});
