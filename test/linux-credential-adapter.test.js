import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createLinuxCredentialAdapter } from "../src/linux-credential-adapter.js";
import { createCredentialStore } from "../src/credential-store.js";

function fakeSecretTool() {
  const items = new Map();
  const calls = [];
  const run = async (args, { input = "" } = {}) => {
    calls.push({ args, input });
    const key = JSON.stringify(args.filter((arg) => !arg.startsWith("--")).slice(1));
    if (args[0] === "store") { items.set(key, input); return { code: 0, stdout: "", stderr: false }; }
    if (args[0] === "lookup") return items.has(key) ? { code: 0, stdout: items.get(key), stderr: false } : { code: 1, stdout: "", stderr: false };
    if (args[0] === "clear") { items.delete(key); return { code: 0, stdout: "", stderr: false }; }
    return { code: 2, stdout: "", stderr: true };
  };
  return { run, calls };
}

test("stores, reads and removes a secret through secret-tool, secret on stdin only (#215)", async () => {
  const { run, calls } = fakeSecretTool();
  const store = createCredentialStore({ adapter: createLinuxCredentialAdapter({ run }) });
  const key = { provider: "jellyfin", identityId: "u1" };
  await store.save(key, "s3cret value");
  assert.equal(await store.read(key), "s3cret value");
  assert.equal(await store.remove(key), true);
  assert.equal(await store.read(key), null);
  assert.equal(await store.remove(key), false);
  assert.deepEqual(calls[0], { args: ["store", "--label=NowPlaying (jellyfin:u1)", "service", "nowplaying", "account", "jellyfin:u1"], input: "s3cret value" });
  for (const call of calls) assert.ok(!call.args.some((arg) => arg.includes("s3cret")), "the secret never goes on the command line");
});

test("a failed lookup is an error, not a missing secret", async () => {
  const adapter = createLinuxCredentialAdapter({ run: async () => ({ code: 1, stdout: "", stderr: true }) });
  await assert.rejects(adapter.getPassword("nowplaying", "plex:1"), /Secret Service request failed/);
  const failedStore = createLinuxCredentialAdapter({ run: async () => ({ code: 1, stdout: "", stderr: true }) });
  await assert.rejects(failedStore.setPassword("nowplaying", "plex:1", "x"), /Secret Service request failed/);
});

test("rejects bad targets and oversized secrets before running anything", async () => {
  let ran = false;
  const adapter = createLinuxCredentialAdapter({ run: async () => { ran = true; return { code: 0, stdout: "" }; } });
  await assert.rejects(adapter.setPassword("bad service", "a", "x"), /target is invalid/);
  await assert.rejects(adapter.setPassword("nowplaying", "a\nb", "x"), /target is invalid/);
  await assert.rejects(adapter.setPassword("nowplaying", "a", "x".repeat(5000)), /too large/);
  await assert.rejects(adapter.setPassword("nowplaying", "a", ""), /required/);
  assert.equal(ran, false);
});

// Real round trip against a Secret Service, when one is available (CI runs
// this under dbus-run-session with gnome-keyring).
// Opt-in so it never touches a developer's own keyring by accident; when it's
// on, a missing secret-tool is a failure, not a skip.
const realTest = process.platform === "linux" && process.env.NOWPLAYING_SECRET_SERVICE_TEST === "1";
test("round trip against the real Secret Service", { skip: !realTest }, async () => {
  assert.equal(spawnSync("secret-tool", ["--version"]).error, undefined, "secret-tool is installed");
  const store = createCredentialStore({ adapter: createLinuxCredentialAdapter() });
  const key = { provider: "navidrome", identityId: `ci-${process.pid}` };
  await store.save(key, "real-secret-éß");
  assert.equal(await store.read(key), "real-secret-éß");
  assert.equal(await store.remove(key), true);
  assert.equal(await store.read(key), null);
});
