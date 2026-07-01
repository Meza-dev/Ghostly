-- CreateTable
CREATE TABLE "user_llm_settings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_llm_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
