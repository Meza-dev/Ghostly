import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  splitting: false,
  treeshake: true,
  // Forzar inline del runner en el bundle final.
  noExternal: ["@ghostly-io/runner"],
  external: ["playwright"],
});
