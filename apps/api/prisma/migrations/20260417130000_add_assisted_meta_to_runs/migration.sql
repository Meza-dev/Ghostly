-- AlterTable runs: add assisted metadata payload for AI-assisted mode
ALTER TABLE "runs" ADD COLUMN "assistedMeta" JSONB;
