import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "tests/foundation/foundation.ts",
      formats: ["es"],
      fileName: "foundation-runtime",
    },
    outDir: ".test-dist/foundation",
    emptyOutDir: true,
    minify: false,
    // Node loads React's own Node build at test time. Bundled, the browser
    // server renderer opens a MessageChannel that keeps `node --test` alive.
    rollupOptions: { external: [/^react(-dom)?(\/.*)?$/] },
  },
});
