import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedLlmConfig } from "./config.js";

const storage = new AsyncLocalStorage<ResolvedLlmConfig>();

export function runWithLlmConfig<T>(config: ResolvedLlmConfig, fn: () => T): T {
  return storage.run(config, fn);
}

export function runWithLlmConfigAsync<T>(
  config: ResolvedLlmConfig,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(config, fn);
}

export function getRequestLlmConfig(): ResolvedLlmConfig | undefined {
  return storage.getStore();
}

export function clearLlmConfigCache(): void {
  // noop hook for client cache invalidation after settings save
}
