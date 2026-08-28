import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
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
