import { prisma } from "../lib/prisma.js";

export type UserLlmSettingsRecord = {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

export async function getUserLlmSettings(
  userId: string,
): Promise<UserLlmSettingsRecord | null> {
  const row = await prisma.userLlmSettings.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    providerId: row.providerId,
    model: row.model,
    ...(row.apiKey ? { apiKey: row.apiKey } : {}),
    ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
  };
}

export async function upsertUserLlmSettings(
  userId: string,
  data: UserLlmSettingsRecord,
): Promise<void> {
  await prisma.userLlmSettings.upsert({
    where: { userId },
    create: {
      userId,
      providerId: data.providerId,
      model: data.model,
      apiKey: data.apiKey ?? null,
      baseUrl: data.baseUrl ?? null,
    },
    update: {
      providerId: data.providerId,
      model: data.model,
      apiKey: data.apiKey ?? null,
      baseUrl: data.baseUrl ?? null,
    },
  });
}
