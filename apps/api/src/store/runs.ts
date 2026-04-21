import crypto from "node:crypto";
import type { AssistEvent, AssistedMeta, RunRecord, Step, StepOutcome } from "@ghosttester/runner";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type RunRecordWithEvents = RunRecord & { events?: AssistEvent[] };

function parseMemorySteps(raw: string): Step[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is Step => !!s && typeof s === "object" && "action" in (s as object));
  } catch {
    return [];
  }
}

function sanitizeMemorySteps(steps: Step[]): Step[] {
  const out: Step[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    // Evitar guardar valores ya redacted para no degradar replays.
    if (step.action === "fill") {
      if (step.value === "[REDACTED]") continue;
    }
    const key = JSON.stringify(step);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out.slice(0, 40);
}

export async function getAssistMemory(params: {
  userId: string;
  project: string;
  baseUrl: string;
  goal: string;
}): Promise<Step[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; stepsJson: string }>>`
    SELECT id, stepsJson
    FROM assist_memories
    WHERE userId = ${params.userId}
      AND project = ${params.project}
      AND baseUrl = ${params.baseUrl}
      AND goal = ${params.goal}
    LIMIT 1
  `;
  const found = rows[0];
  if (!found) return [];
  await prisma.$executeRaw`
    UPDATE assist_memories
    SET hits = hits + 1, updatedAt = CURRENT_TIMESTAMP
    WHERE id = ${found.id}
  `.catch(() => undefined);
  return parseMemorySteps(found.stepsJson);
}

/** Lectura sin incrementar hits (para fusionar antes de guardar tras un fallo). */
export async function peekAssistMemorySteps(params: {
  userId: string;
  project: string;
  baseUrl: string;
  goal: string;
}): Promise<Step[]> {
  const rows = await prisma.$queryRaw<Array<{ stepsJson: string }>>`
    SELECT stepsJson
    FROM assist_memories
    WHERE userId = ${params.userId}
      AND project = ${params.project}
      AND baseUrl = ${params.baseUrl}
      AND goal = ${params.goal}
    LIMIT 1
  `;
  const found = rows[0];
  if (!found) return [];
  return parseMemorySteps(found.stepsJson);
}

export async function upsertAssistMemory(params: {
  userId: string;
  project: string;
  baseUrl: string;
  goal: string;
  steps: Step[];
}): Promise<void> {
  const steps = sanitizeMemorySteps(params.steps);
  if (steps.length === 0) return;
  const serialized = JSON.stringify(steps);
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO assist_memories (id, userId, project, baseUrl, goal, stepsJson, hits, createdAt, updatedAt)
    VALUES (${id}, ${params.userId}, ${params.project}, ${params.baseUrl}, ${params.goal}, ${serialized}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, project, baseUrl, goal)
    DO UPDATE SET
      stepsJson = excluded.stepsJson,
      updatedAt = CURRENT_TIMESTAMP
  `;
}

/**
 * Pre-crea un registro de Run en estado "running". Usado para runs fire-and-forget
 * que se ejecutan en background y cuyo detalle el cliente puede consultar/streamear
 * antes de que la ejecución termine.
 */
export async function createRunningRun(params: {
  id: string;
  userId: string;
  startedAt: string;
  baseUrl: string;
  project: string | null;
  assisted?: AssistedMeta;
}): Promise<void> {
  await prisma.run.create({
    data: {
      id: params.id,
      userId: params.userId,
      status: "running",
      startedAt: new Date(params.startedAt),
      durationMs: 0,
      baseUrl: params.baseUrl,
      project: params.project,
      videoPath: null,
      assistedMeta: params.assisted ? JSON.stringify(params.assisted) : null,
    },
  });
}

/** Inserta un AssistEvent en el registro de RunEvent para persistencia incremental. */
export async function appendRunEvent(
  runId: string,
  event: AssistEvent,
): Promise<void> {
  try {
    await prisma.runEvent.create({
      data: {
        runId,
        sequence: event.seq,
        type: event.type,
        stepIndex: event.stepIndex ?? null,
        payload: JSON.stringify(event.payload ?? {}),
        createdAt: new Date(event.at),
      },
    });
  } catch {
    // Ignorar duplicados o races; el evento ya quedó en el bus en vivo.
  }
}

/**
 * Cierra un run pre-creado con su resultado final: status, duración, steps y videoPath.
 * Los eventos ya fueron persistidos incrementalmente.
 */
export async function finalizeRun(params: {
  id: string;
  status: "pass" | "fail";
  durationMs: number;
  steps: StepOutcome[];
  videoPath?: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.step.deleteMany({ where: { runId: params.id } }),
    prisma.step.createMany({
      data: params.steps.map((s) => ({
        runId: params.id,
        index: s.index,
        action: String(s.action),
        ok: s.ok,
        error: s.error ?? null,
        screenshotPath: s.screenshotPath ?? null,
        a11y: s.a11y != null ? String(s.a11y) : null,
      })),
    }),
    prisma.run.update({
      where: { id: params.id },
      data: {
        status: params.status,
        durationMs: params.durationMs,
        videoPath: params.videoPath ?? null,
      },
    }),
  ]);
}

export async function saveRun(
  record: RunRecordWithEvents,
  userId: string,
): Promise<void> {
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
  if (record.events && record.events.length > 0) {
    data.events = {
      create: record.events.map((e) => ({
        sequence: e.seq,
        type: e.type,
        stepIndex: e.stepIndex ?? null,
        payload: JSON.stringify(e.payload ?? {}),
        createdAt: new Date(e.at),
      })),
    };
  }

  await prisma.run.create({ data });
}

export async function getRun(id: string, userId: string): Promise<RunRecordWithEvents | null> {
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { index: "asc" } },
      events: { orderBy: { sequence: "asc" } },
    },
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
  return runs.map((run) => toRecord({ ...run, events: [] }));
}

type DbRun = Awaited<ReturnType<typeof prisma.run.findUniqueOrThrow>> & {
  steps: Awaited<ReturnType<typeof prisma.step.findMany>>;
  events?: Awaited<ReturnType<typeof prisma.runEvent.findMany>>;
};

function parseAssistedMeta(raw: string | null | undefined): AssistedMeta | undefined {
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw) as AssistedMeta;
  } catch {
    return undefined;
  }
}

function parseEventPayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toRecord(run: DbRun): RunRecordWithEvents {
  const assisted = parseAssistedMeta(run.assistedMeta);
  const events: AssistEvent[] | undefined = run.events?.map((e) => ({
    seq: e.sequence,
    type: e.type as AssistEvent["type"],
    at: e.createdAt.toISOString(),
    ...(e.stepIndex !== null && e.stepIndex !== undefined ? { stepIndex: e.stepIndex } : {}),
    payload: parseEventPayload(e.payload),
  }));
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
    ...(events && events.length > 0 ? { events } : {}),
  };
}
