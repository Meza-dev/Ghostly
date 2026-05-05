import { PrismaClient } from "@prisma/client";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@ghostly.local";
  const password = process.env.ADMIN_PASSWORD ?? "admin123";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Actualizar password si el usuario ya existe (del seed SQL hardcodeado)
    await prisma.user.update({
      where: { email },
      data: { passwordHash: hashPassword(password), role: "admin" },
    });
    console.log(`Admin actualizado: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        email,
        passwordHash: hashPassword(password),
        role: "admin",
      },
    });
    console.log(`Admin creado: ${email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
