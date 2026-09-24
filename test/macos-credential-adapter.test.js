import test from "node:test";
import assert from "node:assert/strict";
import { createMacosCredentialAdapter } from "../src/macos-credential-adapter.js";
import { createCredentialStore } from "../src/credential-store.js";

// Stands in for /usr/bin/security: parses the -i add line the way the real
// tool does for this narrow shape, and answers find/delete with its exit codes.
function fakeSecurity() {
  const items = new Map();
  const calls = [];
  const run = async (args, { input } = {}) => {
    calls.push({ args, input });
    if (args[0] === "-i") {
      const match = /^add-generic-password -U -s "([^"]+)" -a "([^"]+)" -l "NowPlaying" -X ([0-9a-f]+)\n$/.exec(input ?? "");
      if (match) items.set(`${match[1]}|${match[2]}`, Buffer.from(match[3], "hex").toString("utf8"));
      return { code: 0, stdout: "" };
    }
    const key = `${args[args.indexOf("-s") + 1]}|${args[args.indexOf("-a") + 1]}`;
    if (args[0] === "find-generic-password") return items.has(key) ? { code: 0, stdout: `${items.get(key)}\n` } : { code: 44, stdout: "" };
    if (args[0] === "delete-generic-password") return items.delete(key) ? { code: 0, stdout: "" } : { code: 44, stdout: "" };
    return { code: 1, stdout: "" };
  };
  return { run, calls };
}

test("stores, reads and removes a secret in the Keychain, never with the secret in argv (#215)", async () => {
  const { run, calls } = fakeSecurity();
  const store = createCredentialStore({ adapter: createMacosCredentialAdapter({ run }) });
  const key = { provider: "navidrome", identityId: "Rowan K" };
  const secret = JSON.stringify({ token: "t0k\"en", salt: "s\\1" });
  await store.save(key, secret);
  assert.equal(await store.read(key), secret);
  assert.equal(await store.remove(key), true);
  assert.equal(await store.read(key), null);
  assert.equal(await store.remove(key), false);
  for (const call of calls) {
    assert.ok(!call.args.some((arg) => arg.includes("t0k")), "the secret never goes on the command line");
    if (call.input) assert.ok(!call.input.includes("t0k"), "the secret is hex-encoded on stdin");
  }
});

test("a write that didn't land is an error", async () => {
  const adapter = createMacosCredentialAdapter({ run: async (args) => (args[0] === "find-generic-password" ? { code: 44, stdout: "" } : { code: 0, stdout: "" }) });
  await assert.rejects(adapter.setPassword("nowplaying", "plex:1", "abc"), /Keychain request failed/);
});

test("a locked or broken Keychain is an error, not a missing secret", async () => {
  const adapter = createMacosCredentialAdapter({ run: async () => ({ code: 51, stdout: "" }) });
  await assert.rejects(adapter.getPassword("nowplaying", "plex:1"), /Keychain request failed/);
  await assert.rejects(adapter.deletePassword("nowplaying", "plex:1"), /Keychain request failed/);
});

test("refuses targets and secrets it can't pass safely, before running anything", async () => {
  let ran = false;
  const adapter = createMacosCredentialAdapter({ run: async () => { ran = true; return { code: 0, stdout: "" }; } });
  await assert.rejects(adapter.setPassword("nowplaying", "a\"b", "x"), /target is invalid/);
  await assert.rejects(adapter.setPassword("nowplaying", "a\\b", "x"), /target is invalid/);
  await assert.rejects(adapter.setPassword("bad service", "a", "x"), /target is invalid/);
  await assert.rejects(adapter.setPassword("nowplaying", "a", "caf\u00e9"), /printable ASCII/);
  await assert.rejects(adapter.setPassword("nowplaying", "a", "line\nbreak"), /printable ASCII/);
  await assert.rejects(adapter.setPassword("nowplaying", "a", "x".repeat(5000)), /too large/);
  assert.equal(ran, false);
});

// Real round trip on a macOS runner (CI sets the flag).
const realTest = process.platform === "darwin" && process.env.NOWPLAYING_KEYCHAIN_TEST === "1";
test("round trip against the real Keychain", { skip: !realTest }, async () => {
  const store = createCredentialStore({ adapter: createMacosCredentialAdapter() });
  const key = { provider: "navidrome", identityId: `ci ${process.pid}` };
  const secret = JSON.stringify({ token: "real\"tok", salt: "s\\1" });
  await store.save(key, secret);
  assert.equal(await store.read(key), secret);
  assert.equal(await store.remove(key), true);
  assert.equal(await store.read(key), null);
});
