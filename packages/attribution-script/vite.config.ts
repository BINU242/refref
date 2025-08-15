import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import path from "path";

export default defineConfig(({ mode }) => ({
  configLoader: "runner",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    // to emit types for dev purposes?
    dts({
      insertTypesEntry: true,
      outDir: "dist/types",
      exclude: ["src/**/*.test.ts"],
    }),
  ],
  build: {
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "RefRefAttribution",
      fileName: (format) => `attribution-script.${format}.js`,
      formats: ["es", "umd"],
    },
    minify: mode === "production",
    cssCodeSplit: false,
    sourcemap: mode !== "production",
    outDir: "dist",
    emptyOutDir: true,
  },
}));
