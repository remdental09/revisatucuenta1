import { rmSync } from "node:fs";

// Railway may reuse build layers between deployments. Remove only the
// generated Vinext output so every deployment publishes the bundle produced
// by the current commit, including the clinical-account reader.
for (const path of ["dist", ".vinext", ".next"]) {
  rmSync(path, { recursive: true, force: true });
}
