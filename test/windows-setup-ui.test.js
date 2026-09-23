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
  const credentialStore = {
    save: async (key, secret) => { saved.push([key, secret]); },
    // A real Navidrome sign-in is stored as token + salt JSON.
    read: async (key) => (saved.some(([k]) => k.identityId === key.identityId) ? JSON.stringify({ token: "t", salt: "s" }) : undefined),
  };
  // Fake Navidrome for "Test connection": nothing playing, and the sign-in is the selftest user.
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const body = path.endsWith("/getUser.view")
      ? { "subsonic-response": { status: "ok", user: { username: "selftest" } } }
      : { "subsonic-response": { status: "ok", nowPlaying: {} } };
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  const startupApplied = [];
  const startup = { isEnabled: async () => false, setEnabled: async (value) => { startupApplied.push(value); } };
  const app = await startSetupApp({
    draftFile: join(dir, "draft.json"), configFile: join(dir, "config.json"), credentialStore, deviceId: "selftest-device", signIn, startup, fetchImpl,
    discover: async () => [{ provider: "navidrome", baseUrl: "http://127.0.0.1:4533", version: "0.53.3" }],
  });
  try {
    const scriptPath = fileURLToPath(new URL("../scripts/windows-setup.ps1", import.meta.url));
    const { code, output, errors } = await runNativeSetup(app.url, { sessionSecret: app.sessionSecret, scriptPath, selfTest: true });
    assert.equal(code, 0, `${output}\n${errors}`);
    const result = JSON.parse(output);
    assert.deepEqual(result.steps, ["welcome", "provider", "signin", "signin", "discord", "review", "complete"]);
    assert.deepEqual([result.provider, result.account, result.startWithWindows], ["navidrome", "Self Test", true]);
    assert.equal(result.connectionTest, "Connected. NowPlaying can see what you're playing.");
    assert.deepEqual(startupApplied, [true]);
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

// Launches the real window exactly as the app does (windowsHide) and asks
// Windows whether it is actually visible. The headless self-test above can't
// catch a window that renders correctly but never appears (#87 first launch).
test("native setup window is actually visible when launched like the app launches it", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-native-visible-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), deviceId: "selftest-device", discover: async () => [] });
  try {
    const scriptPath = fileURLToPath(new URL("../scripts/windows-setup.ps1", import.meta.url));
    const unfixed = await runNativeSetup(app.url, { sessionSecret: app.sessionSecret, scriptPath, visibilityProbe: true, probeWithoutShowFix: true });
    console.log(`without the first-show fix: ${unfixed.output || unfixed.errors}`);
    const { code, output, errors } = await runNativeSetup(app.url, { sessionSecret: app.sessionSecret, scriptPath, visibilityProbe: true });
    assert.equal(code, 0, `${output}\n${errors}`);
    assert.deepEqual(JSON.parse(output), { visible: true });
  } finally {
    await app.close();
  }
});

test("runNativeSetup launches hidden PowerShell with the probe flags only when asked", async () => {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const child = { stdout: null, stderr: null, on(event, fn) { if (event === "close") setImmediate(() => fn(0)); return child; } };
    return child;
  };
  const scriptPath = "C:\\app\\scripts\\windows-setup.ps1";
  await runNativeSetup("http://127.0.0.1:4321/setup", { scriptPath, spawnProcess });
  await runNativeSetup("http://127.0.0.1:4321/setup", { scriptPath, spawnProcess, visibilityProbe: true });
  await runNativeSetup("http://127.0.0.1:4321/setup", { scriptPath, spawnProcess, probeWithoutShowFix: true });
  assert.ok(calls.every((call) => call.command === "powershell.exe" && call.options.windowsHide === true && call.args.includes("-STA")));
  assert.ok(!calls[0].args.includes("-VisibilityProbe") && calls[0].options.stdio === "ignore");
  assert.ok(calls[1].args.includes("-VisibilityProbe") && !calls[1].args.includes("-ProbeWithoutShowFix"));
  assert.ok(!calls[2].args.includes("-ProbeWithoutShowFix"), "the unfixed probe needs visibilityProbe too");
});
