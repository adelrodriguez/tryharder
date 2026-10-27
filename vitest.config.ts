import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    benchmark: {
      include: ["src/**/*.bench.ts"],
      // Benchmarks import `src` through Vite's module runner on purpose, so `check` does not depend on a build.
      suppressExportGetterWarnings: true,
    },
    coverage: {
      exclude: ["scripts/**"],
      provider: "v8",
    },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
})
