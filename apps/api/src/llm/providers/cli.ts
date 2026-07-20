import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliRunResult } from "../cli-runner.js";
import type { ResolvedLlmConfig } from "../config.js";
import { LlmError } from "../errors.js";
import type { LlmCompleteRequest, LlmCompleteResult, LlmProvider } from "../types.js";
import type { CliAgentDef } from "./cli-registry.js";

export class CliLlmProvider implements LlmProvider {
  readonly providerId: string;

  constructor(
    private readonly config: ResolvedLlmConfig,
    private readonly def: CliAgentDef,
  ) {
    this.providerId = def.id;
  }

  async isAvailable(): Promise<boolean> {
    // El atajo por API key evita spawnear el CLI (login no interactivo).
    if (process.env[this.def.authEnvVar]?.trim()) return true;
    const cwd = this.config.cliWorkspace;
    try {
      // Antes se corría `--version` (5s) y luego `status` (8s). El `--version`
      // era redundante —`status` ya prueba que el binario arranca y el login— y
      // su timeout de 5s reventaba en frío: el arranque de cursor-agent es lento
      // y muy variable (medido 3.5–11.5s), así que el check daba false flaky y
      // Ghostly reportaba el CLI como "no conectado" aunque `agent status`
      // dijera "logged in". Un solo `status` con timeout holgado lo cubre.
      const { stdout } = await runCli(this.config.cliBin, ["status"], { cwd, timeoutMs: 20_000 });
      return this.def.isStatusOk(stdout);
    } catch {
      return false;
    }
  }

  async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const startedAt = Date.now();
    const prompt = this.buildPrompt(req);
    const model = req.model ?? this.config.model ?? this.def.defaultModel;
    const args = this.def.buildArgs({ model });

    // IA-2.2: el agente CLI corría con cwd = raíz del monorepo, dándole acceso a
    // TODO el repo (código, .env, dev.db). El strategist/healer solo razonan
    // sobre el stdin — no necesitan FS. Se lanza en un directorio temporal vacío
    // y efímero por invocación, y se limpia al terminar (best-effort). Contiene
    // el blast radius de una inyección indirecta que instruya al agente a leer
    // archivos locales.
    const workspace = await mkdtemp(join(tmpdir(), "ghostly-cli-"));
    let result: CliRunResult;
    try {
      result = await runCli(this.config.cliBin, args, {
        cwd: workspace,
        timeoutMs: req.timeoutMs,
        stdin: prompt,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        throw new LlmError(`Timeout al consultar ${this.def.label}`, 504, this.providerId);
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new LlmError(
          `${this.def.label} no encontrado (${this.config.cliBin}). Instálalo o define ${this.def.binEnvVar}.`,
          503,
          this.providerId,
        );
      }
      throw new LlmError(
        error instanceof Error ? error.message : String(error),
        502,
        this.providerId,
      );
    } finally {
      // El parseo posterior no necesita el workspace: se descarta ya.
      void rm(workspace, { recursive: true, force: true }).catch(() => {});
    }

    const { stdout, stderr, exitCode } = result;
    if (exitCode !== 0) {
      throw new LlmError(
        `${this.def.label} terminó con código ${exitCode}: ${stderr.slice(0, 300)}`,
        502,
        this.providerId,
      );
    }

    const parsed = this.def.parseStdout(stdout);
    if (parsed.isError) {
      throw new LlmError(
        parsed.error ?? `${this.def.label} reportó error`,
        502,
        this.providerId,
      );
    }
    if (!parsed.text) {
      throw new LlmError(`Respuesta vacía de ${this.def.label}`, 502, this.providerId);
    }

    return {
      rawText: parsed.text,
      usage: parsed.usage,
      providerId: this.providerId,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private buildPrompt(req: LlmCompleteRequest): string {
    const parts = req.messages.map((m) =>
      m.role === "system" ? `## Sistema\n${m.content}` : `## Usuario\n${m.content}`,
    );
    if (req.jsonMode !== false) {
      parts.push("## Formato\nResponde ÚNICAMENTE con JSON válido. Sin markdown, sin texto extra.");
    }
    return parts.join("\n\n");
  }
}
