import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PTY / process-tree tests need more than Vitest's 5s default on CI.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
