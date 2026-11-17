import { defineConfig } from "vitest/config";

export default defineConfig({
  // Extension pages load assets relative to the page, not from the site root.
  base: "./",
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: { popup: "popup.html" },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
