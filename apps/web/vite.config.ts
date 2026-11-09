import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.LARNESS_API_URL ?? "http://127.0.0.1:3210";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
      "/ws": {
        target: apiTarget,
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    // Preserve the Vite 7 browser baseline during the build-tool upgrade.
    target: ["chrome107", "edge107", "firefox104", "safari16"],
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
