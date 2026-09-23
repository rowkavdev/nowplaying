import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createCredentialStore } from "../src/credential-store.js";
import { createWindowsCredentialAdapter, runPowerShell, WINDOWS_CREDENTIAL_SCRIPT } from "../src/windows-credential-adapter.js";

function fakeVault() {
  const items = new Map();
  const calls = [];
  const run = async (request) => {
    calls.push(request);
    if (request.op === "set") { items.set(request.target, request.secret); return { ok: true }; }
    if (request.op === "get") return { ok: true, secret: items.get(request.target) ?? null };
    if (request.op === "delete") return { ok: true, deleted: items.delete(request.target) };
    return { ok: false };
  };
  return { run, items, calls };
}

test("round-trips credentials through the credential store", async () => {
  const vault = fakeVault();
  const store = createCredentialStore({ adapter: createWindowsCredentialAdapter({ run: vault.run }) });
  await store.save({ provider: "jellyfin", identityId: "abc123" }, "s3cret");
  assert.deepEqual([...vault.items.keys()], ["nowplaying:jellyfin:abc123"]);
  assert.equal(await store.read({ provider: "jellyfin", identityId: "abc123" }), "s3cret");
  assert.equal(await store.remove({ provider: "jellyfin", identityId: "abc123" }), true);
  assert.equal(await store.read({ provider: "jellyfin", identityId: "abc123" }), null);
  assert.equal(await store.remove({ provider: "jellyfin", identityId: "abc123" }), false);
});

test("rejects unsafe targets and oversized or empty secrets before calling Windows", async () => {
  const vault = fakeVault();
  const adapter = createWindowsCredentialAdapter({ run: vault.run });
  await assert.rejects(adapter.setPassword("nowplaying", "plex:a\nb", "x"), /target/);
  await adapter.setPassword("nowplaying", "navidrome:John Smith", "x");
  vault.calls.length = 0;
  await assert.rejects(adapter.getPassword("now playing", "plex:a"), /target/);
  await assert.rejects(adapter.setPassword("nowplaying", "plex:a", ""), /secret/);
  await assert.rejects(adapter.setPassword("nowplaying", "plex:a", "x".repeat(1281)), /too large/);
  assert.equal(vault.calls.length, 0);
  await assert.rejects(createWindowsCredentialAdapter({ run: async () => ({ ok: false }) }).getPassword("nowplaying", "plex:a"), /failed/);
});

function fakeChild({ code = 0, stdout = "", hang = false } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.received = "";
  child.stdin.on("data", (chunk) => { child.received += chunk; });
  child.kill = () => { child.killed = true; };
  child.stdin.on("finish", () => {
    if (hang) return;
    setImmediate(() => { child.stdout.end(stdout); child.stderr.end("echo: s3cret"); child.emit("close", code); });
  });
  return child;
}

test("sends secrets over stdin only and never exposes stderr", async () => {
  let spawned;
  const spawnProcess = (command, args, options) => { spawned = { command, args, options, child: fakeChild({ stdout: '{"ok":true}' }) }; return spawned.child; };
  assert.deepEqual(await runPowerShell({ op: "set", target: "nowplaying:plex:a", secret: "s3cret" }, { spawnProcess }), { ok: true });
  assert.equal(spawned.command, "powershell.exe");
  assert.equal(spawned.options.shell, false);
  assert.ok(!spawned.args.join(" ").includes("s3cret"));
  assert.match(spawned.child.received, /s3cret/);
  const decoded = Buffer.from(spawned.args.at(-1), "base64").toString("utf16le");
  assert.equal(decoded, WINDOWS_CREDENTIAL_SCRIPT);

  const failing = () => fakeChild({ code: 1 });
  await assert.rejects(runPowerShell({ op: "get", target: "nowplaying:plex:a" }, { spawnProcess: failing }), (error) => !/s3cret/.test(error.message));
  await assert.rejects(runPowerShell({ op: "get", target: "nowplaying:plex:a" }, { spawnProcess: () => fakeChild({ stdout: "nope" }) }), /invalid response/);
  const hung = fakeChild({ hang: true });
  await assert.rejects(runPowerShell({ op: "get", target: "nowplaying:plex:a" }, { spawnProcess: () => hung, timeoutMs: 20 }), /timed out/);
  assert.equal(hung.killed, true);
});

test("uses local-machine persistence and zeroes the secret buffer", () => {
  assert.match(WINDOWS_CREDENTIAL_SCRIPT, /Persist = 2/);
  assert.match(WINDOWS_CREDENTIAL_SCRIPT, /Type = 1/);
  assert.match(WINDOWS_CREDENTIAL_SCRIPT, /InputEncoding = \$utf8/);
  assert.match(WINDOWS_CREDENTIAL_SCRIPT, /Array\.Clear\(bytes/);
});

test("round-trips through real Windows Credential Manager", { skip: process.platform !== "win32" }, async () => {
  const store = createCredentialStore({ adapter: createWindowsCredentialAdapter() });
  const target = { provider: "plex", identityId: `ci-${process.pid}-${Date.now()}` };
  try {
    await store.save(target, "p@ss wörd ✓");
    assert.equal(await store.read(target), "p@ss wörd ✓");
  } finally {
    assert.equal(await store.remove(target), true);
  }
  assert.equal(await store.read(target), null);
});
