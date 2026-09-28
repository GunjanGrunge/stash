import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only build of the screen preview. Output never ships: the app's own
// build (vite.config.ts) only includes src/.
export default defineConfig({
  root: "preview",
  plugins: [react()],
  build: {
    outDir: "../.preview-dist",
    emptyOutDir: true,
  },
});
