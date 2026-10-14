import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't spin up the Cloudflare runtime.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
