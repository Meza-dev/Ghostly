import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  // No limpiar dist completo: puede contener assets runtime (prisma engine)
  // bloqueados temporalmente por procesos vivos en Windows.
  clean: false,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  splitting: false,
  treeshake: true,
  // Prisma client usa binarios nativos y no puede ser bundleado
  external: ["@prisma/client", "prisma"],
});
