import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import dts from "vite-plugin-dts";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  configLoader: "runner",
  plugins: [
    react(),
    tailwindcss(),
    ,
    /* cssInjectedByJsPlugin({
      // Inject CSS before our bundle code
      topExecutionPriority: true,
      // Add a unique ID to avoid conflicts
      styleId: "referral-widget-styles",
    }) */ dts({
      insertTypesEntry: true,
      outDir: "dist/types",
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
  },
  build: {
    target: "esnext",
    lib: {
      entry: path.resolve(__dirname, "src/widget/index.tsx"),
      name: "ReferralWidget",
      fileName: (format) => `referral-widget.${format}.js`,
      formats: ["es", "umd"],
    },
    minify: mode === "production",
    cssCodeSplit: false,
    sourcemap: mode !== "production",
    outDir: "dist",
    emptyOutDir: true,
  },
}));
