-- CreateTable
CREATE TABLE "assist_memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "assist_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "assist_memories_userId_project_baseUrl_goal_key" ON "assist_memories"("userId", "project", "baseUrl", "goal");

-- CreateIndex
CREATE INDEX "assist_memories_userId_project_updatedAt_idx" ON "assist_memories"("userId", "project", "updatedAt");
