import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    seed: "prisma/seed.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: false,
  bundle: true,
  splitting: false,
  treeshake: true,
  // Forzar inline del runner en el bundle final.
  noExternal: ["@ghostly-io/runner"],
  external: ["playwright"],
});
