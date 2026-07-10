/**
 * Serialización del dossier del juez a mensajes de LLM (Fase 3b, GHOST-30).
 *
 * Estas funciones son PURAS (sin I/O, sin LLM, sin Playwright) a propósito:
 * viven en el runner para poder probarlas con vitest + un LLM MOCK, sin
 * depender de un provider real ni de apps/api (que no tiene test runner).
 * `apps/api/src/services/assist-orchestrator.ts` (`createJudge`) solo hace
 * wiring fino sobre esto: arma el dossier, llama a estas funciones para
 * construir el prompt, invoca al LLM del usuario, y valida la respuesta con
 * `validateJudgeVerdict` (ya cubierto en `judge.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT } from "../judge.js";
import type { JudgeDossier } from "../types.js";

function dossier(overrides: Partial<JudgeDossier> = {}): JudgeDossier {
  return {
    goal: "Crear una nota con título 'Reunión de equipo'",
    reason: "victory-candidate",
    recentActions: [
      { step: "fill [data-testid=\"note-title-input\"]", outcome: "ok" },
      { step: "click [data-testid=\"save-note-button\"]", outcome: "ok" },
    ],
    currentSnapshot: "https://example.test/notes | Notas | nodes=5\n- heading: Notas",
    snapshotDiff: "tree: cambió (ver currentSnapshot para el estado completo)",
    pageErrors: [],
    deterministicChecks: [{ check: "victory.textIncludes('Reunión de equipo')", passed: false }],
    ...overrides,
  };
}

describe("JUDGE_SYSTEM_PROMPT (spec §4.3 — reglas de comportamiento del juez)", () => {
  it("is a non-empty Spanish system prompt", () => {
    expect(JUDGE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("encodes rule 1: the judge classifies, never acts (no ejecuta pasos)", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/clasific/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/jam[aá]s.*(propon|ejecut).*pasos/i);
  });

  it("encodes rule 2: anti-false-success bias (inconclusive over unproven success)", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/falso.?[eé]xito/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/inconclusive/i);
  });

  it("encodes rule 3: never contradicts hard deterministic evidence", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/determinist/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/success.{0,40}proh|proh.{0,40}success/i);
  });

  it("encodes rule 4: distinguishes responsible party across the 6-verdict taxonomy", () => {
    for (const verdict of [
      "fail-app-bug",
      "fail-test-broken",
      "fail-agent-lost",
      "inconclusive-environment",
    ]) {
      expect(JUDGE_SYSTEM_PROMPT).toContain(verdict);
    }
  });

  it("encodes rule 5: continue cap (max 2 interventions per reason)", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/2/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/continue/i);
  });

  it("requires output conforming to the strict JudgeVerdict contract (mentions the required fields)", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/verdict/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/confidence/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/reasoning/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/evidence/i);
  });
});

describe("buildJudgeUserPrompt (dossier -> texto para el LLM, spec §4.3)", () => {
  it("includes the goal, trigger reason, and victory condition when present", () => {
    const prompt = buildJudgeUserPrompt(
      dossier({ victoryCondition: { textIncludes: ["Reunión de equipo"], mustAll: true } }),
    );
    expect(prompt).toContain("Reunión de equipo");
    expect(prompt).toContain("victory-candidate");
    expect(prompt).toMatch(/textIncludes/);
  });

  it("reports 'sin condición configurada' when there is no victory condition", () => {
    const prompt = buildJudgeUserPrompt(dossier({ victoryCondition: undefined }));
    expect(prompt).toMatch(/sin condici[oó]n|no configurada/i);
  });

  it("includes recentActions with their outcome, in order", () => {
    const prompt = buildJudgeUserPrompt(
      dossier({
        recentActions: [
          { step: "fill x", outcome: "ok" },
          { step: "click y", outcome: "healed" },
          { step: "click z", outcome: "failed", error: "timeout" },
        ],
      }),
    );
    const fillIdx = prompt.indexOf("fill x");
    const clickYIdx = prompt.indexOf("click y");
    const clickZIdx = prompt.indexOf("click z");
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(clickYIdx).toBeGreaterThan(fillIdx);
    expect(clickZIdx).toBeGreaterThan(clickYIdx);
    expect(prompt).toMatch(/healed/i);
    expect(prompt).toContain("timeout");
  });

  it("includes pageErrors with severity and source when present", () => {
    const prompt = buildJudgeUserPrompt(
      dossier({
        pageErrors: [
          { source: "network", severity: "warning", message: "GET /notes -> 404", observedAtStep: 1 },
        ],
      }),
    );
    expect(prompt).toContain("GET /notes -> 404");
    expect(prompt).toMatch(/warning/i);
    expect(prompt).toMatch(/network/i);
  });

  it("reports 'sin errores' explicitly when pageErrors is empty (avoid silent omission)", () => {
    const prompt = buildJudgeUserPrompt(dossier({ pageErrors: [] }));
    expect(prompt).toMatch(/sin errores|ninguno/i);
  });

  it("includes deterministicChecks with pass/fail state", () => {
    const prompt = buildJudgeUserPrompt(
      dossier({
        deterministicChecks: [
          { check: "victory.met", passed: false },
          { check: "victory.configured", passed: true },
        ],
      }),
    );
    expect(prompt).toContain("victory.met");
    expect(prompt).toMatch(/false|fall[oó]/i);
    expect(prompt).toContain("victory.configured");
  });

  it("includes the current snapshot and the snapshot diff", () => {
    const prompt = buildJudgeUserPrompt(
      dossier({
        currentSnapshot: "UNIQUE_SNAPSHOT_MARKER",
        snapshotDiff: "UNIQUE_DIFF_MARKER",
      }),
    );
    expect(prompt).toContain("UNIQUE_SNAPSHOT_MARKER");
    expect(prompt).toContain("UNIQUE_DIFF_MARKER");
  });

  it("never mentions the screenshot field — the text dossier must be self-sufficient (spec §4.3)", () => {
    const prompt = buildJudgeUserPrompt(dossier());
    // El prompt de texto no debe depender de/mencionar una imagen: es
    // autosuficiente por contrato. El adjunto de imagen (si aplica) se agrega
    // aparte, a nivel de mensaje LLM, nunca como parte de este texto.
    expect(prompt.toLowerCase()).not.toContain("screenshot");
  });
});
