import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

export type AppConfig = {
  port: number;
  host: string;
  nodeEnv: string;
  assist: {
    enabled: boolean;
    maxSteps: number;
    maxTimeoutMs: number;
    maxGoalChars: number;
    llmTimeoutMs: number;
  };
  assistV2: {
    enabled: boolean;
    chunkSize: number;
    healingAttempts: number;
    observerMaxNodes: number;
    maxHorizons: number;
    stepsPerHorizon: number;
    maxLoopMs: number;
    modalLoaderMaxWaitMs: number;
    memoryMode: "off" | "runtime" | "adaptive";
  };
};

function hydrateEnv(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(moduleDir, "../../.env"),
    resolve(moduleDir, "../../../.env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
      break;
    }
  }
}

export function loadConfig(): AppConfig {
  hydrateEnv();
  const parseIntOr = (raw: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const parseMemoryMode = (
    raw: string | undefined,
  ): "off" | "runtime" | "adaptive" => {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "off" || v === "runtime" || v === "adaptive") return v;
    return "runtime";
  };
  const rawPort = process.env.API_PORT ?? process.env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  const host = process.env.HOST ?? "0.0.0.0";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    port: Number.isFinite(port) ? port : 3000,
    host,
    nodeEnv,
    assist: {
      enabled: (process.env.ASSIST_ENABLED ?? "true").toLowerCase() !== "false",
      maxSteps: parseIntOr(process.env.ASSIST_MAX_STEPS, 25),
      maxTimeoutMs: parseIntOr(process.env.ASSIST_MAX_TIMEOUT_MS, 120_000),
      maxGoalChars: parseIntOr(process.env.ASSIST_MAX_GOAL_CHARS, 2_000),
      llmTimeoutMs: parseIntOr(process.env.ASSIST_LLM_TIMEOUT_MS, 45_000),
    },
    assistV2: {
      enabled: (process.env.ASSIST_V2_ENABLED ?? "true").toLowerCase() !== "false",
      chunkSize: parseIntOr(process.env.ASSIST_V2_CHUNK_SIZE, 3),
      healingAttempts: parseIntOr(process.env.ASSIST_V2_HEALING_ATTEMPTS, 1),
      observerMaxNodes: parseIntOr(process.env.ASSIST_V2_OBSERVER_MAX_NODES, 300),
      maxHorizons: parseIntOr(process.env.ASSIST_V2_MAX_HORIZONS, 12),
      stepsPerHorizon: parseIntOr(process.env.ASSIST_V2_STEPS_PER_HORIZON, 3),
      maxLoopMs: parseIntOr(process.env.ASSIST_V2_MAX_LOOP_MS, 300_000),
      modalLoaderMaxWaitMs: parseIntOr(process.env.ASSIST_V2_MODAL_LOADER_MAX_MS, 180_000),
      memoryMode: parseMemoryMode(process.env.ASSIST_V2_MEMORY_MODE),
    },
  };
}
