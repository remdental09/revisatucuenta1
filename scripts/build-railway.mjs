import { spawnSync } from "node:child_process";

// Railway may not expose its service markers during the build phase. Set an
// explicit, non-secret marker so Vite always selects the Node server build;
// runtime secrets then remain available to API routes through process.env.
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(packageManager, ["run", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RAILWAY_NODE_RUNTIME: "true" },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
