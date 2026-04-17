import { prisma } from "../lib/prisma.js";

export type ProjectRecord = {
  id: string;
  label: string;
  color: string;
  createdAt: string;
};

export async function getAllProjects(userId: string): Promise<ProjectRecord[]> {
  const rows = await prisma.project.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRecord);
}

export async function createProject(userId: string, label: string, color?: string): Promise<ProjectRecord> {
  const row = await prisma.project.create({
    data: { userId, label, ...(color ? { color } : {}) },
  });
  return toRecord(row);
}

export async function deleteProject(id: string, userId: string): Promise<void> {
  const row = await prisma.project.findUnique({ where: { id } });
  if (!row || row.userId !== userId) throw new Error("not found");
  await prisma.project.delete({ where: { id } });
}

export async function projectExistsForUser(id: string, userId: string): Promise<boolean> {
  const row = await prisma.project.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  return row !== null;
}

function toRecord(row: { id: string; label: string; color: string; createdAt: Date }): ProjectRecord {
  return { id: row.id, label: row.label, color: row.color, createdAt: row.createdAt.toISOString() };
}
