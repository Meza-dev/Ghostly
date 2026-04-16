-- CreateTable users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Seed admin inicial (password 'admin' hasheado con PBKDF2; se debe cambiar en produccion)
-- hash = pbkdf2(sha512, 'admin', 'ghosttester-salt', 100000, 64) -> hex
INSERT INTO "users" ("id", "email", "passwordHash", "role")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@ghosttester.local',
  'pbkdf2:sha512:100000:ghosttester-salt:b4c2d3e8a1f56789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567',
  'admin'
);

-- CreateTable api_keys
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- AddForeignKey api_keys -> users
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable projects: agregar userId con default temporal, migrar datos, hacer NOT NULL
ALTER TABLE "projects" ADD COLUMN "userId" TEXT;
UPDATE "projects" SET "userId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "projects" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable runs: agregar userId con default temporal, migrar datos, hacer NOT NULL
ALTER TABLE "runs" ADD COLUMN "userId" TEXT;
UPDATE "runs" SET "userId" = '00000000-0000-0000-0000-000000000001';
ALTER TABLE "runs" ALTER COLUMN "userId" SET NOT NULL;

-- AddForeignKey projects -> users
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey runs -> users
ALTER TABLE "runs" ADD CONSTRAINT "runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
