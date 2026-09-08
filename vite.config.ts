import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { resolve } from "node:path";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// Railway runs the application as a regular Node service.  The Cloudflare
// plugin intentionally evaluates RSC/API routes in workerd, whose bindings
// do not include Railway's private environment variables.  Keep the plugin
// for Cloudflare/Sites builds, but use the Node runtime whenever Railway (or
// the persistent Node data directory) is present so server secrets such as
// OPENAI_API_KEY remain available to API routes.
const isRailwayNodeRuntime = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.REVISA_DATA_DIR,
);

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = isRailwayNodeRuntime
    ? { cloudflare: undefined }
    : await import("@cloudflare/vite-plugin");

  const plugins = [vinext(), sites()];
  if (cloudflare) plugins.push(cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    config: localBindingConfig,
  }));

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins,
    ...(isRailwayNodeRuntime
      ? { resolve: { alias: { "cloudflare:workers": resolve(process.cwd(), "lib/server/cloudflare-workers-node-shim.ts") } } }
      : {}),
  };
});
