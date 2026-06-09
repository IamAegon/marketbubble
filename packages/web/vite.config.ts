import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // consume shared types from source so Vite transpiles them as part of the app graph
      "@app/shared": fileURLToPath(new URL("../shared-types/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
