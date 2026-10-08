import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  resolve: {
    // One copy of each, or R3F context is split between Canvas and hooks.
    dedupe: ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei"],
  },
  build: {
    target: "es2022",
    outDir: "dist-wasm",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        wasm: fileURLToPath(new URL("./wasm.html", import.meta.url)),
      },
    },
  },
});
