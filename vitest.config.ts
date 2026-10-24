import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: "postgresql://clm@localhost:5433/clm_test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      STORAGE_DIR: "./.test-storage",
      STORAGE_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
      ESIGN_PROVIDER: "mock",
      EMAIL_PROVIDER: "outbox",
    },
  },
});
