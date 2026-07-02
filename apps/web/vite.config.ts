import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    port: 5273,
    strictPort: true,
    proxy: {
      "/v1": "http://localhost:4000",
      "/artifacts": "http://localhost:4000",
    },
  },
});
