import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runNativeSetup, startSetupApp } from "../src/setup-app.js";

// Runs the real WinForms setup window in self-test mode on Windows: it renders
// every step against the real setup server without being shown.
test("native setup window walks every step against the real server", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-native-setup-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), discover: async () => [{ provider: "navidrome", baseUrl: "http://127.0.0.1:4533", version: "0.53.3" }] });
  try {
    const scriptPath = fileURLToPath(new URL("../scripts/windows-setup.ps1", import.meta.url));
    const { code, output } = await runNativeSetup(app.url, { scriptPath, selfTest: true });
    assert.equal(code, 0, output);
    const result = JSON.parse(output);
    assert.deepEqual(result.steps, ["welcome", "provider", "provider", "discord", "review", "complete"]);
    assert.equal(result.provider, "navidrome");
    const saved = await (await fetch(new URL("/api/setup/draft", app.url))).json();
    assert.deepEqual([saved.draft.step, saved.draft.provider], ["complete", "navidrome"]);
  } finally {
    await app.close();
  }
});
