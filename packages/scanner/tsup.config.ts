import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/scan.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  // El scanner se copia al CLI empaquetado (dist/assets/scanner) sin node_modules:
  // las dependencias deben ir bundleadas para que sea autocontenido.
  noExternal: ["glob", "zod"],
  splitting: false,
  treeshake: true,
  dts: true,
});
