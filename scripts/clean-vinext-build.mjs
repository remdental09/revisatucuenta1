import { rmSync } from "node:fs";

// Railway may reuse build layers between deployments. Remove generated
// Vinext output so every deployment publishes the bundle produced by the
// current commit, including the clinical-account reader. `.next` can be a
// mounted cache on Railway and may legitimately be locked by the builder;
// it is not a published Vinext artifact, so leave it intact in that case.
for (const path of ["dist", ".vinext", ".next"]) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (path !== ".next" || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code)) {
      throw error;
    }
  }
}
