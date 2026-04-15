import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  splitting: false,
  treeshake: true,
  external: ["playwright", "@ghosttester/runner"],
});
