import type { AssistedMeta, RunRecord } from "@ghosttester/runner";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function saveRun(record: RunRecord, userId: string): Promise<void> {
  const data: Prisma.RunUncheckedCreateInput = {
    id: record.id,
    userId,
    status: record.status,
    startedAt: new Date(record.startedAt),
    durationMs: record.durationMs,
    baseUrl: record.baseUrl,
    project: record.project ?? null,
    videoPath: record.videoPath ?? null,
    steps: {
      create: record.steps.map((s) => ({
        index: s.index,
        action: String(s.action),
        ok: s.ok,
        error: s.error ?? null,
        screenshotPath: s.screenshotPath ?? null,
        a11y: s.a11y != null ? String(s.a11y) : null,
      })),
    },
  };
  if (record.assisted) {
    data.assistedMeta = JSON.stringify(record.assisted);
  }

  await prisma.run.create({
    data,
  });
}

export async function getRun(id: string, userId: string): Promise<RunRecord | null> {
  const run = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!run || run.userId !== userId) return null;
  return toRecord(run);
}

export async function getAllRuns(userId: string, project?: string): Promise<RunRecord[]> {
  const runs = await prisma.run.findMany({
    where: { userId, ...(project ? { project } : {}) },
    include: { steps: { orderBy: { index: "asc" } } },
    orderBy: { startedAt: "desc" },
  });
  return runs.map(toRecord);
}

type DbRun = Awaited<ReturnType<typeof prisma.run.findUniqueOrThrow>> & {
  steps: Awaited<ReturnType<typeof prisma.step.findMany>>;
};

function parseAssistedMeta(raw: string | null | undefined): AssistedMeta | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw) as AssistedMeta;
  } catch {
    return undefined;
  }
}

function toRecord(run: DbRun): RunRecord {
  const assisted = parseAssistedMeta(run.assistedMeta);
  return {
    id: run.id,
    status: run.status as RunRecord["status"],
    startedAt: run.startedAt.toISOString(),
    durationMs: run.durationMs,
    baseUrl: run.baseUrl,
    ...(run.project ? { project: run.project } : {}),
    ...(assisted ? { assisted } : {}),
    ...(run.videoPath ? { videoPath: run.videoPath } : {}),
    steps: run.steps.map((s) => ({
      index: s.index,
      action: s.action as RunRecord["steps"][number]["action"],
      ok: s.ok,
      ...(s.error ? { error: s.error } : {}),
      ...(s.screenshotPath ? { screenshotPath: s.screenshotPath } : {}),
      ...(s.a11y ? { a11y: s.a11y } : {}),
    })),
  };
}
