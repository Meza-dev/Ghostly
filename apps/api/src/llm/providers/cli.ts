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
    const cwd = this.config.cliWorkspace;
    try {
      await runCli(this.config.cliBin, ["--version"], { cwd, timeoutMs: 5_000 });
    } catch {
      return false;
    }
    if (process.env[this.def.authEnvVar]?.trim()) return true;
    try {
      const { stdout } = await runCli(this.config.cliBin, ["status"], { cwd, timeoutMs: 8_000 });
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

    let result: CliRunResult;
    try {
      result = await runCli(this.config.cliBin, args, {
        cwd: this.config.cliWorkspace,
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
