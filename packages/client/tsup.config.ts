import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: false,
  dts: true,
  bundle: true,
  splitting: false,
  treeshake: true,
});
