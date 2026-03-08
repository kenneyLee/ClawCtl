import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "src/__tests__/setup.ts")],
    globals: true,
    include: [resolve(__dirname, "src/**/*.{test,spec}.{ts,tsx}")],
  },
});
