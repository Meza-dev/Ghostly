export type McpEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type InjectResult = {
  status: "injected" | "already" | "skipped-backup" | "unsupported";
  detail?: string;
};

export interface McpClient {
  id: "cursor" | "claude-desktop" | "claude-code" | "antigravity" | "codex" | "opencode";
  label: string;
  supported: boolean;
  /** Mensaje mostrado tras un inject exitoso. Si falta, se usa un genérico "restart/reload {label}". */
  restartHint?: string;
  detect(): boolean;
  isConfigured(): boolean;
  inject(entry: McpEntry): InjectResult;
  installGuidance?(): void;
}
