import { readFile } from "node:fs/promises";
import { createBuildProvenance } from "./build-provenance.js";

const PACKAGE_TYPES = new Set(["portable", "deb", "rpm", "arch"]);

// Build markers travel with the payload. Never guess an install type from
// /opt, the current working directory, or an environment variable.
export async function readPosixPackageInfo(appDirectory) {
  let packageType = "source";
  let build = null;
  try {
    const marker = JSON.parse(await readFile(new URL("package-info.json", appDirectory), "utf8"));
    if (PACKAGE_TYPES.has(marker.packageType)) packageType = marker.packageType;
  } catch { /* Source checkouts and older packages have no marker. */ }
  try {
    build = createBuildProvenance(JSON.parse(await readFile(new URL("build-info.json", appDirectory), "utf8")));
  } catch { /* An absent/damaged build identity must not prevent startup. */ }
  return Object.freeze({ packageType, build });
}
