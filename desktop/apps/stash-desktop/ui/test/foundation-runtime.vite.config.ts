import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "tests/foundation/foundation.test.ts",
      formats: ["es"],
      fileName: "foundation-runtime",
    },
    outDir: ".test-dist/foundation",
    emptyOutDir: true,
    minify: false,
  },
});
