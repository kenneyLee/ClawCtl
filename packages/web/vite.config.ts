import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 7101,
    proxy: {
      "/api": { target: "http://127.0.0.1:7100", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:7100", ws: true, changeOrigin: true },
    },
  },
});
