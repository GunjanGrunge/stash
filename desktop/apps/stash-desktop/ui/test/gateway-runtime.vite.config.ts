import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "test/gateway-runtime-entry.ts",
      formats: ["es"],
      fileName: "gateway-runtime",
    },
    outDir: ".test-dist",
    emptyOutDir: true,
    minify: false,
  },
});
