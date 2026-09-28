import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  publicDir: "../assets",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
