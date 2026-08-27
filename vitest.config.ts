import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      exclude: ["bench/**"],
      provider: "v8",
    },
    include: ["src/**/*.test.ts", "bench/**/*.test.ts"],
  },
})
