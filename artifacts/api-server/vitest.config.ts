import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    timeout: 30_000,
    // supertest talks plain HTTP, so keep the session cookie's Secure flag off
    // even when the workspace ssl/ certificates are present.
    env: { ENABLE_HTTPS: "false" },
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
