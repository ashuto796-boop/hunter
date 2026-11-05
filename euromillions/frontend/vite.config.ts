/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  preview: { port: 4173, proxy: { "/api": { target: apiTarget, changeOrigin: true } } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { charts: ["recharts"], vendor: ["react", "react-dom", "react-router-dom"] } } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
