import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignInError } from "../src/provider-signin.js";
import { createSetupSignInHandler } from "../src/setup-signin-handler.js";
import { loadOrCreateDeviceId, startSetupApp } from "../src/setup-app.js";

const DEVICE = "device-0123456789";

function fakeStore() {
  const saved = []; const values = new Map();
  const key = (ref) => `${ref.provider}:${ref.identityId}`;
  return { saved, values, read: async (ref) => values.get(key(ref)) ?? null,
    remove: async (ref) => values.delete(key(ref)),
    save: async (input, secret) => { saved.push({ ...input, secret }); values.set(key(input), secret); return { stored: true }; } };
}

function fakeSignIn(overrides = {}) {
  const calls = [];
  const record = (name, value) => async (args) => { calls.push({ name, args }); return typeof value === "function" ? value(args) : value; };
  return {
    calls,
    startPlexPin: record("startPlexPin", { pinId: 42, authUrl: "https://app.plex.tv/auth#?code=abc" }),
    pollPlexPin: record("pollPlexPin", { status: "signed_in", provider: "plex", identity: { id: "7", displayName: "rowan" }, secret: "plex-token" }),
    startJellyfinQuickConnect: record("startJellyfinQuickConnect", { secret: "qc-secret", code: "123456" }),
    pollJellyfinQuickConnect: record("pollJellyfinQuickConnect", { status: "pending" }),
    signInEmby: record("signInEmby", { provider: "emby", identity: { id: "u1", displayName: "Rowan" }, secret: "emby-token" }),
    signInNavidrome: record("signInNavidrome", { provider: "navidrome", identity: { id: "rowan", displayName: "rowan" }, secret: "{\"token\":\"t\",\"salt\":\"s\"}" }),
    ...overrides,
  };
}

const post = (handler, body) => handler({ method: "POST", url: "/api/setup/signin", body: typeof body === "string" ? body : JSON.stringify(body) });
const read = (response) => JSON.parse(response.body);
const SECRETS = /plex-token|qc-secret|emby-token|hunter2|"token"|"salt"|pinId|\b42\b/;

test("Plex: start returns only the sign-in link and a flow id, poll saves the token", async () => {
  const store = fakeStore();
  const signIn = fakeSignIn();
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn, newFlowId: () => "flow-1" });
  const started = await post(handler, { action: "start", provider: "plex" });
  assert.equal(started.status, 200);
  assert.deepEqual(read(started), { status: "pending", flowId: "flow-1", provider: "plex", authUrl: "https://app.plex.tv/auth#?code=abc" });
  assert.equal(signIn.calls[0].args.clientId, DEVICE);
  const done = await post(handler, { action: "poll", flowId: "flow-1" });
  assert.deepEqual(read(done), { status: "signed_in", provider: "plex", identity: { id: "7", displayName: "rowan" } });
  assert.doesNotMatch(done.body, SECRETS);
  assert.deepEqual(store.saved, [{ provider: "plex", identityId: "7", secret: "plex-token" }]);
  assert.equal(done.headers["Cache-Control"], "no-store");
  // The flow is single-use.
  assert.equal((await post(handler, { action: "poll", flowId: "flow-1" })).status, 410);
});

test("Jellyfin: shows the Quick Connect code, stays pending, keeps the secret server-side", async () => {
  const store = fakeStore();
  let approved = false;
  const signIn = fakeSignIn({
    pollJellyfinQuickConnect: async (args) => {
      assert.equal(args.secret, "qc-secret");
      assert.equal(args.baseUrl, "http://127.0.0.1:8096");
      return approved ? { status: "signed_in", provider: "jellyfin", identity: { id: "j1", displayName: "Rowan" }, secret: "jf-token" } : { status: "pending" };
    },
  });
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn, newFlowId: () => "flow-j" });
  const started = await post(handler, { action: "start", provider: "jellyfin", baseUrl: "http://127.0.0.1:8096" });
  assert.deepEqual(read(started), { status: "pending", flowId: "flow-j", provider: "jellyfin", code: "123456" });
  assert.doesNotMatch(started.body, /qc-secret/);
  assert.deepEqual(read(await post(handler, { action: "poll", flowId: "flow-j" })), { status: "pending" });
  assert.equal(store.saved.length, 0);
  approved = true;
  const done = await post(handler, { action: "poll", flowId: "flow-j" });
  assert.equal(read(done).status, "signed_in");
  assert.doesNotMatch(done.body, /jf-token/);
  assert.deepEqual(store.saved, [{ provider: "jellyfin", identityId: "j1", secret: "jf-token" }]);
});

test("an in-flight provider poll cannot save credentials after cancellation", async () => {
  for (const provider of ["plex", "jellyfin"]) {
    const store = fakeStore();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const done = provider === "plex"
      ? { status: "signed_in", provider, identity: { id: "7", displayName: "Rowan" }, secret: "token" }
      : { status: "signed_in", provider, identity: { id: "j7", displayName: "Rowan" }, secret: "token" };
    const signIn = fakeSignIn({ [provider === "plex" ? "pollPlexPin" : "pollJellyfinQuickConnect"]: async () => pending });
    let updates = 0;
    const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn, onSignedIn: async () => { updates++; } });
    const started = read(await post(handler, { action: "start", provider, baseUrl: "http://127.0.0.1:32400" }));
    const polling = post(handler, { action: "poll", flowId: started.flowId });
    assert.deepEqual(read(await post(handler, { action: "cancel", flowId: started.flowId })), { status: "cancelled" });
    release(done);
    assert.deepEqual(read(await polling), { error: "expired" });
    assert.deepEqual(store.saved, []);
    assert.equal(updates, 0);
  }
});

test("only one provider poll can claim a flow at a time", async () => {
  const store = fakeStore();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let polls = 0;
  const signIn = fakeSignIn({ pollPlexPin: async () => { polls++; return pending; } });
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn });
  const started = read(await post(handler, { action: "start", provider: "plex" }));
  const first = post(handler, { action: "poll", flowId: started.flowId });
  const second = await post(handler, { action: "poll", flowId: started.flowId });
  assert.deepEqual(read(second), { error: "poll_in_progress" });
  assert.equal(polls, 1);
  release({ status: "signed_in", provider: "plex", identity: { id: "7", displayName: "Rowan" }, secret: "token" });
  assert.equal(read(await first).status, "signed_in");
  assert.equal(store.saved.length, 1);
  assert.equal((await post(handler, { action: "poll", flowId: started.flowId })).status, 410);
});

test("Cancel during finish validation prevents Plex and Jellyfin writes", async () => {
  for (const provider of ["plex", "jellyfin"]) {
    const store = fakeStore();
    let release;
    const validation = new Promise((resolve) => { release = resolve; });
    let validating;
    const startedValidation = new Promise((resolve) => { validating = resolve; });
    const signIn = fakeSignIn({
      [provider === "plex" ? "pollPlexPin" : "pollJellyfinQuickConnect"]: async () => ({
        status: "signed_in", provider, identity: { id: "7", displayName: "Rowan" }, secret: "token",
      }),
    });
    const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn,
      beforeSignedIn: async () => { validating(); await validation; } });
    const { flowId } = read(await post(handler, { action: "start", provider, baseUrl: "http://127.0.0.1:32400" }));
    const polling = post(handler, { action: "poll", flowId });
    await startedValidation;
    assert.deepEqual(read(await post(handler, { action: "poll", flowId })), { error: "poll_in_progress" });
    assert.deepEqual(read(await post(handler, { action: "cancel", flowId })), { status: "cancelled" });
    release();
    assert.deepEqual(read(await polling), { error: "expired" });
    assert.deepEqual(store.saved, []);
  }
});

test("Cancel cannot claim success once a sign-in has started committing", async () => {
  let release;
  const pendingSave = new Promise((resolve) => { release = resolve; });
  const store = fakeStore();
  const save = store.save;
  let saving;
  const startedSaving = new Promise((resolve) => { saving = resolve; });
  store.save = async (ref, secret) => { saving(); await pendingSave; return save(ref, secret); };
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn: fakeSignIn() });
  const started = read(await post(handler, { action: "start", provider: "plex" }));
  const polling = post(handler, { action: "poll", flowId: started.flowId });
  await startedSaving;
  const cancelled = await post(handler, { action: "cancel", flowId: started.flowId });
  assert.deepEqual(read(cancelled), { status: "cancelled" });
  release();
  assert.deepEqual(read(await polling), { error: "expired" });
  assert.equal(store.saved.length, 1); // new value and rollback removal below are tracked separately
  assert.equal(store.values.size, 0);
});

test("an expired committing flow cannot be cancelled after a second poll (Plex/Jellyfin)", async () => {
  for (const provider of ["plex", "jellyfin"]) {
    let time = 1000;
    let release;
    const pendingUpdate = new Promise((resolve) => { release = resolve; });
    let updating;
    const startedUpdate = new Promise((resolve) => { updating = resolve; });
    const store = fakeStore();
    const signIn = fakeSignIn({
      [provider === "plex" ? "pollPlexPin" : "pollJellyfinQuickConnect"]: async () => ({
        status: "signed_in", provider, identity: { id: "7", displayName: "Rowan" }, secret: "token",
      }),
    });
    const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn,
      elapsedNow: () => time, flowTtlMs: 100, onSignedIn: async () => { updating(); await pendingUpdate; } });
    const { flowId } = read(await post(handler, { action: "start", provider, baseUrl: "http://127.0.0.1:32400" }));
    const polling = post(handler, { action: "poll", flowId });
    await startedUpdate;
    time += 101;
    assert.deepEqual(read(await post(handler, { action: "poll", flowId })), { error: "poll_in_progress" });
    const cancelled = await post(handler, { action: "cancel", flowId });
    assert.equal(cancelled.status, 409);
    assert.deepEqual(read(cancelled), { error: "signin_in_progress" });
    release();
    assert.equal(read(await polling).status, "signed_in");
    assert.equal(store.saved.length, 1);
    assert.equal((await post(handler, { action: "poll", flowId })).status, 410);
  }
});

test("a provider response arriving after flow expiry cannot save a credential", async () => {
  const store = fakeStore();
  let time = 1000;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const signIn = fakeSignIn({ pollPlexPin: async () => pending });
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn, elapsedNow: () => time, flowTtlMs: 100 });
  const started = read(await post(handler, { action: "start", provider: "plex" }));
  const polling = post(handler, { action: "poll", flowId: started.flowId });
  time += 101;
  release({ status: "signed_in", provider: "plex", identity: { id: "7", displayName: "Rowan" }, secret: "token" });
  assert.deepEqual(read(await polling), { error: "expired" });
  assert.deepEqual(store.saved, []);
});

test("Emby and Navidrome: password sign-in saves the secret and never echoes the password", async () => {
  const store = fakeStore();
  const signIn = fakeSignIn();
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn });
  for (const provider of ["emby", "navidrome"]) {
    const response = await post(handler, { action: "password", provider, baseUrl: "http://127.0.0.1:8096", username: "rowan", password: "hunter2" });
    assert.equal(response.status, 200);
    assert.equal(read(response).provider, provider);
    assert.doesNotMatch(response.body, SECRETS);
  }
  assert.deepEqual(store.saved.map((s) => s.provider), ["emby", "navidrome"]);
  assert.equal(signIn.calls.find((c) => c.name === "signInEmby").args.deviceId, DEVICE);
});

test("flows expire, are capped, and can be cancelled", async () => {
  let time = 1000;
  let n = 0;
  const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn: fakeSignIn(), elapsedNow: () => time, flowTtlMs: 100, maxFlows: 2, newFlowId: () => `f${++n}` });
  await post(handler, { action: "start", provider: "plex" });
  await post(handler, { action: "start", provider: "plex" });
  assert.deepEqual(read(await post(handler, { action: "start", provider: "plex" })), { error: "too_many_signins" });
  assert.deepEqual(read(await post(handler, { action: "cancel", flowId: "f1" })), { status: "cancelled" });
  assert.equal((await post(handler, { action: "start", provider: "plex" })).status, 200);
  time += 101;
  assert.deepEqual(read(await post(handler, { action: "poll", flowId: "f2" })), { error: "expired" });
  assert.equal((await post(handler, { action: "poll", flowId: "nope" })).status, 410);
});

test("a flow past its elapsed TTL expires and frees the slot (#759)", async () => {
  for (const provider of ["plex", "jellyfin"]) {
    let time = 1000;
    let n = 0;
    const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn: fakeSignIn(), elapsedNow: () => time, flowTtlMs: 10_000, maxFlows: 1, newFlowId: () => `f${++n}` });
    const start = provider === "plex" ? { action: "start", provider } : { action: "start", provider, baseUrl: "http://127.0.0.1:8096" };
    await post(handler, start);
    // Eleven elapsed seconds pass, past the ten-second TTL. The flow reads
    // only elapsed time, so this is the rollback case from the issue: with
    // the wall clock a one-hour rollback kept the flow pending, blocked the
    // second start with 429, and let a late completion save the credential.
    time += 11_000;
    assert.equal((await post(handler, { action: "poll", flowId: "f1" })).status, 410, provider);
    assert.equal((await post(handler, start)).status, 200, provider);
  }
});

test("sign-in errors map to safe codes and end the flow", async () => {
  const signIn = fakeSignIn({
    pollPlexPin: async () => { throw new SignInError("expired"); },
    signInEmby: async () => { throw new SignInError("authentication_failed"); },
    signInNavidrome: async () => { throw new SignInError("unreachable"); },
    startJellyfinQuickConnect: async () => { throw new Error("socket hang up at 10.0.0.5 with token abc"); },
  });
  const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn, newFlowId: () => "f" });
  await post(handler, { action: "start", provider: "plex" });
  assert.deepEqual(read(await post(handler, { action: "poll", flowId: "f" })), { error: "expired" });
  assert.equal((await post(handler, { action: "poll", flowId: "f" })).status, 410);
  const emby = await post(handler, { action: "password", provider: "emby", baseUrl: "http://x", username: "a", password: "b" });
  assert.deepEqual([emby.status, read(emby)], [400, { error: "authentication_failed" }]);
  const nav = await post(handler, { action: "password", provider: "navidrome", baseUrl: "http://x", username: "a", password: "b" });
  assert.equal(nav.status, 502);
  const jf = await post(handler, { action: "start", provider: "jellyfin", baseUrl: "http://x" });
  assert.deepEqual([jf.status, read(jf)], [500, { error: "signin_failed" }]);
  assert.doesNotMatch(jf.body, /10\.0\.0\.5|abc/);
});

test("a credential store failure is reported without the secret", async () => {
  const handler = createSetupSignInHandler({ credentialStore: { read: async () => null, remove: async () => {}, save: async () => { throw new Error("CredWrite failed plex-token"); } }, deviceId: DEVICE, signIn: fakeSignIn(), newFlowId: () => "f" });
  await post(handler, { action: "start", provider: "plex" });
  const response = await post(handler, { action: "poll", flowId: "f" });
  assert.deepEqual([response.status, read(response)], [500, { error: "credential_store_failed" }]);
});

test("rejects bad input and other routes", async () => {
  const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn: fakeSignIn() });
  assert.equal(await handler({ method: "GET", url: "/api/setup/draft" }), null);
  assert.equal((await handler({ method: "GET", url: "/api/setup/signin" })).status, 405);
  assert.equal((await handler({ method: "POST", url: "/api/setup/signin?x=1", body: "{}" })).status, 400);
  assert.deepEqual(read(await post(handler, "not json")), { error: "invalid_json" });
  for (const body of [
    [], { action: "nope" }, { action: "__proto__" }, { action: "start", provider: "emby" }, { action: "start", provider: "plex", baseUrl: "ftp://x" }, { action: "start", provider: "plex", baseUrl: "http://u:p@x" },
    { action: "start", provider: "jellyfin" }, { action: "start", provider: "plex", extra: 1 },
    { action: "password", provider: "plex", baseUrl: "http://x", username: "a", password: "b" },
    { action: "password", provider: "emby", baseUrl: "http://x", username: " ", password: "b" },
    { action: "password", provider: "emby", baseUrl: "http://x", username: "a", password: "x".repeat(3000) },
    { action: "poll" }, { action: "poll", flowId: 5 },
  ]) {
    assert.equal((await post(handler, body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.throws(() => createSetupSignInHandler({ deviceId: DEVICE }), /credentialStore/);
  assert.throws(() => createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: "short" }), /deviceId/);
});

test("the setup server only offers sign-in when a credential store is supplied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-signin-"));
  try {
    const plain = await startSetupApp({ draftFile: join(dir, "draft.json"), discover: async () => [] });
    const withStore = await startSetupApp({ draftFile: join(dir, "draft2.json"), discover: async () => [], credentialStore: fakeStore(), deviceId: DEVICE });
    try {
      const call = ({ url: base, sessionSecret }) => fetch(new URL("/api/setup/signin", base), { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(base).origin, "X-Nowplaying-Session": sessionSecret }, body: JSON.stringify({ action: "poll", flowId: "x" }) });
      assert.notEqual((await call(plain)).status, 410);
      assert.equal((await call(withStore)).status, 410);
    } finally {
      await plain.close();
      await withStore.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the device id is created once and then reused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-device-"));
  try {
    const file = join(dir, "nowplaying", "device-id");
    const first = await loadOrCreateDeviceId(file, { random: () => "abcdef0123456789" });
    const second = await loadOrCreateDeviceId(file, { random: () => "should-not-be-used" });
    assert.equal(first, "abcdef0123456789");
    assert.equal(second, first);
    assert.equal((await readFile(file, "utf8")).trim(), first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a sign-in reports the server address it used, never the secret", async () => {
  const signedIn = [];
  const signIn = fakeSignIn({ pollJellyfinQuickConnect: async () => ({ status: "signed_in", provider: "jellyfin", identity: { id: "j1", displayName: "Rowan" }, secret: "jf-token" }) });
  let n = 0;
  const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn, newFlowId: () => `flow-${n += 1}`, onSignedIn: async (event) => { signedIn.push(event); } });
  await post(handler, { action: "start", provider: "plex", baseUrl: "http://127.0.0.1:32400/" });
  await post(handler, { action: "poll", flowId: "flow-1" });
  await post(handler, { action: "start", provider: "plex" });
  await post(handler, { action: "poll", flowId: "flow-2" });
  await post(handler, { action: "start", provider: "jellyfin", baseUrl: "http://127.0.0.1:8096" });
  await post(handler, { action: "poll", flowId: "flow-3" });
  await post(handler, { action: "password", provider: "emby", baseUrl: "https://emby.local:8920/", username: "rowan", password: "hunter2" });
  assert.deepEqual(signedIn.map((event) => event.serverUrl), ["http://127.0.0.1:32400", undefined, "http://127.0.0.1:8096", "https://emby.local:8920"]);
  assert.doesNotMatch(JSON.stringify(signedIn), SECRETS);
});

test("a failure to record a new account removes its secret", async () => {
  const store = fakeStore();
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn: fakeSignIn(), onSignedIn: async () => { throw new Error("disk"); } });
  const response = await post(handler, { action: "password", provider: "emby", baseUrl: "http://x", username: "rowan", password: "hunter2" });
  assert.deepEqual([response.status, read(response)], [500, { error: "draft_update_failed" }]);
  assert.equal(await store.read({ provider: "emby", identityId: "u1" }), null);
});

test("a failed re-sign-in restores the previous credential", async () => {
  const store = fakeStore();
  await store.save({ provider: "emby", identityId: "u1" }, "old-token");
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn: fakeSignIn(), onSignedIn: async () => { throw Error("disk"); } });
  const response = await post(handler, { action: "password", provider: "emby", baseUrl: "http://x", username: "rowan", password: "hunter2" });
  assert.deepEqual([response.status, read(response)], [500, { error: "draft_update_failed" }]);
  assert.equal(await store.read({ provider: "emby", identityId: "u1" }), "old-token");
});

test("rollback failure does not falsely claim the secret was removed", async () => {
  const store = fakeStore();
  store.remove = async () => { throw Error("OS credential manager unavailable"); };
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn: fakeSignIn(), onSignedIn: async () => { throw Error("disk"); } });
  const response = await post(handler, { action: "password", provider: "emby", baseUrl: "http://x", username: "rowan", password: "hunter2" });
  assert.deepEqual([response.status, read(response)], [500, { error: "credential_store_failed" }]);
  assert.doesNotMatch(response.body, /OS credential manager|emby-token/);
});


test("a credential write that throws after storing is compensated", async () => {
  const store = fakeStore();
  const save = store.save;
  store.save = async (ref, secret) => { await save(ref, secret); throw Error("disk stopped after OS write"); };
  const handler = createSetupSignInHandler({ credentialStore: store, deviceId: DEVICE, signIn: fakeSignIn() });
  const response = await post(handler, { action: "password", provider: "emby", baseUrl: "http://x", username: "rowan", password: "hunter2" });
  assert.deepEqual([response.status, read(response)], [500, { error: "credential_store_failed" }]);
  assert.equal(await store.read({ provider: "emby", identityId: "u1" }), null);
});

test('#811 same-identity credential commits serialize rollback before newer success', async () => {
  let entered, release, value = 'original';
  const inside = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const handler = createSetupSignInHandler({ deviceId: DEVICE,
    credentialStore: { read: async () => value, save: async (_ref, secret) => { value = secret; }, remove: async () => { value = null; } },
    signIn: { signInEmby: async ({ password }) => ({ provider: 'emby', identity: { id: 'same', displayName: 'Fixture' }, secret: password }) },
    onSignedIn: async ({ serverUrl }) => { if (serverUrl === 'https://older.example') { entered(); await gate; throw Error('fixture config failure'); } },
  });
  const post = (password, baseUrl) => handler({ url: '/api/setup/signin', method: 'POST', body: JSON.stringify({ action: 'password', provider: 'emby', baseUrl, username: 'Fixture', password }) });
  const older = post('older', 'https://older.example'); await inside;
  let completed = false;
  const newer = post('newer', 'https://newer.example').then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  const premature = completed;
  release();
  assert.equal((await older).status, 500);
  assert.equal((await newer).status, 200);
  assert.equal(premature, false, 'newer write waits for old save/config/rollback transaction');
  assert.equal(value, 'newer');
});

test("concurrent starts cannot exceed maxFlows, and a failed start frees its slot", async () => {
  for (const provider of ["plex", "jellyfin"]) {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    let started = 0; let fail = false;
    const hold = (value) => async () => { started += 1; await gate; if (fail) throw new SignInError("network_error"); return value; };
    const signIn = fakeSignIn({
      startPlexPin: hold({ pinId: 42, authUrl: "https://app.plex.tv/auth#?code=abc" }),
      startJellyfinQuickConnect: hold({ secret: "qc-secret", code: "123456" }),
    });
    let n = 0;
    const handler = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn, maxFlows: 2, newFlowId: () => `f${++n}` });
    const body = { action: "start", provider, ...(provider === "jellyfin" ? { baseUrl: "http://127.0.0.1:8096" } : {}) };
    const pending = Array.from({ length: 6 }, () => post(handler, body));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, 2, `${provider}: only maxFlows provider requests may be in flight`);
    release();
    const results = await Promise.all(pending);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 429, 429, 429, 429], provider);
    // Failed starts must not leak capacity.
    const second = createSetupSignInHandler({ credentialStore: fakeStore(), deviceId: DEVICE, signIn, maxFlows: 1 });
    fail = true;
    assert.notEqual((await post(second, body)).status, 200);
    fail = false;
    assert.equal((await post(second, body)).status, 200, `${provider}: slot freed after failure`);
  }
});
