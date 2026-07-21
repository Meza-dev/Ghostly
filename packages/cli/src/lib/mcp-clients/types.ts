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
  detect(): boolean;
  isConfigured(): boolean;
  inject(entry: McpEntry): InjectResult;
  installGuidance?(): void;
}
