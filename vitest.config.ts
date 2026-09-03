import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Real Postgres (PGlite) boots per suite; give it room.
    testTimeout: 20_000,
  },
});
