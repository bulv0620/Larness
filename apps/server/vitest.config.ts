import os from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

// Real-process suites (node-pty terminals, a real Vite dev server, spawned
// commands, preview proxies) are slow and compete for the same CPU and disk.
// One forked worker per core made 13 of them fail on contention; capping the
// worker count keeps the same wall time and makes the run reproducible.
const maxWorkers = Math.min(6, Math.max(2, os.availableParallelism() - 1));

export default defineConfig({
  test: {
    maxWorkers,
    // Benchmark fixtures live under tmp and contain their own *.test.js.
    exclude: [...configDefaults.exclude, "tmp/**"],
    // PTY / process-tree tests need more than Vitest's 5s default on CI; the
    // slowest real-process test takes ~27s, so keep roughly 2x headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
