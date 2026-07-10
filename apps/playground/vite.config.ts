import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ghostlyFakeApiPlugin } from "./src/server/plugin.js";

export default defineConfig({
  plugins: [react(), ghostlyFakeApiPlugin()],
  build: {
    sourcemap: false,
  },
  server: {
    port: 4700,
    strictPort: true,
  },
});
