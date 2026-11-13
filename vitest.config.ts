// Runs unit tests in Cloudflare's workerd-compatible Vitest environment.

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ config: true })],
  test: { include: ["test/**/*.test.ts"] },
});
