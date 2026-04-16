-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "baseUrl" TEXT NOT NULL,
    "videoPath" TEXT,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steps" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "screenshotPath" TEXT,
    "a11y" TEXT,

    CONSTRAINT "steps_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
