import { prisma } from "../lib/prisma.js";

export type ProjectRecord = {
  id: string;
  label: string;
  color: string;
  createdAt: string;
};

export async function getAllProjects(): Promise<ProjectRecord[]> {
  const rows = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toRecord);
}

export async function createProject(label: string, color?: string): Promise<ProjectRecord> {
  const row = await prisma.project.create({
    data: { label, ...(color ? { color } : {}) },
  });
  return toRecord(row);
}

export async function deleteProject(id: string): Promise<void> {
  await prisma.project.delete({ where: { id } });
}

function toRecord(row: { id: string; label: string; color: string; createdAt: Date }): ProjectRecord {
  return { id: row.id, label: row.label, color: row.color, createdAt: row.createdAt.toISOString() };
}
