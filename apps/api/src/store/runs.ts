import type { RunRecord } from "@ghosttester/runner";

const store = new Map<string, RunRecord>();

export function saveRun(record: RunRecord): void {
  store.set(record.id, record);
}

export function getRun(id: string): RunRecord | undefined {
  return store.get(id);
}

export function getAllRuns(): RunRecord[] {
  return [...store.values()].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}
