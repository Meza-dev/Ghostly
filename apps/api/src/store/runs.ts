import type { RunRecord } from "@ghosttester/runner";
import { prisma } from "../lib/prisma.js";

export async function saveRun(record: RunRecord): Promise<void> {
  await prisma.run.create({
    data: {
      id: record.id,
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
    },
  });
}

export async function getRun(id: string): Promise<RunRecord | null> {
  const run = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  if (!run) return null;
  return toRecord(run);
}

export async function getAllRuns(project?: string): Promise<RunRecord[]> {
  const runs = await prisma.run.findMany({
    where: project ? { project } : undefined,
    include: { steps: { orderBy: { index: "asc" } } },
    orderBy: { startedAt: "desc" },
  });
  return runs.map(toRecord);
}

type DbRun = Awaited<ReturnType<typeof prisma.run.findUniqueOrThrow>> & {
  steps: Awaited<ReturnType<typeof prisma.step.findMany>>;
};

function toRecord(run: DbRun): RunRecord {
  return {
    id: run.id,
    status: run.status as RunRecord["status"],
    startedAt: run.startedAt.toISOString(),
    durationMs: run.durationMs,
    baseUrl: run.baseUrl,
    ...(run.project ? { project: run.project } : {}),
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
