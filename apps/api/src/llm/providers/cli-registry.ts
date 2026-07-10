/** Definición de un agente CLI invocable como proveedor LLM (extensible: antigravity-cli, etc.) */
export type CliAgentDef = {
  id: string;
  label: string;
  defaultBin: string;
  /** Env var para override del binario */
  binEnvVar: string;
  defaultModel: string;
  /** Env var de API key opcional (bypass de login interactivo) */
  authEnvVar: string;
  buildArgs: (opts: { model: string }) => string[];
  parseStdout: (stdout: string) => {
    text: string;
    usage?: Record<string, unknown>;
    isError: boolean;
    error?: string;
  };
  isStatusOk: (stdout: string) => boolean;
};

function parseCursorAgentStdout(stdout: string): {
  text: string;
  usage?: Record<string, unknown>;
  isError: boolean;
  error?: string;
} {
  const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
  try {
    const envelope = JSON.parse(line) as {
      subtype?: string;
      is_error?: boolean;
      result?: string;
      usage?: Record<string, unknown>;
      error?: string;
    };
    const isError = Boolean(envelope.is_error) || envelope.subtype === "error";
    return {
      text: envelope.result?.trim() ?? "",
      usage: envelope.usage,
      isError,
      error: envelope.error,
    };
  } catch {
    return { text: stdout.trim(), isError: false };
  }
}

export const CLI_AGENT_REGISTRY: Record<string, CliAgentDef> = {
  "cursor-cli": {
    id: "cursor-cli",
    label: "Cursor Agent CLI",
    defaultBin: "agent",
    binEnvVar: "CURSOR_AGENT_BIN",
    defaultModel: "composer-2.5",
    authEnvVar: "CURSOR_API_KEY",
    buildArgs: ({ model }) => [
      "-p",
      "--output-format",
      "json",
      "--trust",
      "--mode",
      "ask",
      "--model",
      model,
      // El agente chequea updates en cada arranque y su instalador (`irm | iex`)
      // dispara la detección ClickFix de Windows Defender en cada llamada al LLM.
      "--disable-auto-update",
    ],
    parseStdout: parseCursorAgentStdout,
    isStatusOk: (stdout) => /logged in|✓/i.test(stdout),
  },
};
