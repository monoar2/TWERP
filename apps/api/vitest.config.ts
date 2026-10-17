import { defineConfig } from "vitest/config";

export default defineConfig({
  // Test files share the cluster-wide erp_ai_reader role, so run them one at a time.
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, fileParallelism: false, hookTimeout: 60_000 },
});
