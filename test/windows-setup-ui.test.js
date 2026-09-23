import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runNativeSetup, startSetupApp } from "../src/setup-app.js";

// Runs the real WinForms setup window in self-test mode on Windows: it renders
// every step against the real setup server without being shown.
test("native setup window walks every step, including sign-in, against the real server", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-native-setup-"));
  const saved = [];
  const signIn = {
    signInNavidrome: async ({ baseUrl, username, password }) => {
      assert.deepEqual([baseUrl, username, password], ["http://127.0.0.1:4533", "selftest", "selftest-password"]);
      return { provider: "navidrome", identity: { id: "selftest", displayName: "Self Test" }, secret: "nd-secret" };
    },
  };
  const credentialStore = { save: async (key, secret) => { saved.push([key, secret]); } };
  const app = await startSetupApp({
    draftFile: join(dir, "draft.json"), configFile: join(dir, "config.json"), credentialStore, deviceId: "selftest-device", signIn,
    discover: async () => [{ provider: "navidrome", baseUrl: "http://127.0.0.1:4533", version: "0.53.3" }],
  });
  try {
    const scriptPath = fileURLToPath(new URL("../scripts/windows-setup.ps1", import.meta.url));
    const { code, output, errors } = await runNativeSetup(app.url, { scriptPath, selfTest: true });
    assert.equal(code, 0, `${output}\n${errors}`);
    const result = JSON.parse(output);
    assert.deepEqual(result.steps, ["welcome", "provider", "signin", "signin", "discord", "review", "complete"]);
    assert.deepEqual([result.provider, result.account], ["navidrome", "Self Test"]);
    assert.deepEqual(saved, [[{ provider: "navidrome", identityId: "selftest" }, "nd-secret"]]);
    const draft = await (await fetch(new URL("/api/setup/draft", app.url))).json();
    assert.deepEqual([draft.draft.step, draft.draft.provider, draft.draft.account.id], ["complete", "navidrome", "selftest"]);
    const configText = await readFile(join(dir, "config.json"), "utf8");
    const config = JSON.parse(configText);
    assert.deepEqual([config.provider, config.serverUrl, config.credentialRef], ["navidrome", "http://127.0.0.1:4533", { provider: "navidrome", identityId: "selftest" }]);
    assert.doesNotMatch(configText, /nd-secret|selftest-password/);
  } finally {
    await app.close();
  }
});
