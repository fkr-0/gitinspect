import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // One copy of each, or R3F context is split between Canvas and hooks.
    dedupe: ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
