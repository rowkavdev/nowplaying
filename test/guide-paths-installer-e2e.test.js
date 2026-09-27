import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// The installer E2E itself runs only on the guide-drift workflow's Windows
// job; everywhere else it must refuse loudly instead of half-running.
test("windows-installer-e2e refuses to run off Windows", async (t) => {
  if (process.platform === "win32") return t.skip("guard test runs off-Windows");
  await assert.rejects(
    promisify(execFile)(process.execPath, ["scripts/windows-installer-e2e.js"]),
    (error) => error.code === 2 && /runs on Windows only/.test(error.stderr),
  );
});
