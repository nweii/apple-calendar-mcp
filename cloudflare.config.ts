// Configures cf development and deployments. Set account-specific bindings here before deploying.
import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "apple-calendar-mcp",
    compatibilityDate: "2026-08-27",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    entrypoint: "src/worker.ts",
    workersDev: true,
    previewUrls: false,
    env: {
      CALENDAR_TIME_ZONE: bindings.text("UTC"),
      ICLOUD_USERNAME: bindings.secret(),
      ICLOUD_APP_PASSWORD: bindings.secret(),
      APPROVAL_PASSWORD: bindings.secret(),
      OAUTH_KV: bindings.kv({}),
    },
  },
});
