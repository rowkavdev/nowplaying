import test from "node:test";
import assert from "node:assert/strict";
import { createSetupSpotifyHandler } from "../src/setup-spotify-handler.js";

const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const post = (body) => ({ method: "POST", url: "/api/setup/spotify", body: JSON.stringify(body) });
const parse = (response) => JSON.parse(response.body);

function fakeSignIn() {
  const calls = [];
  const signIn = ({ clientId, openUrl }) => new Promise((resolve, reject) => {
    calls.push({ clientId, resolve, reject });
    openUrl(`https://accounts.spotify.com/authorize?client_id=${clientId}`);
  });
  return { calls, signIn };
}

function setup(overrides = {}) {
  const saved = [];
  const values = new Map();
  const key = (ref) => `${ref.provider}:${ref.identityId}`;
  const signedIn = [];
  const fake = fakeSignIn();
  const handle = createSetupSpotifyHandler({
    credentialStore: { read: async (ref) => values.get(key(ref)) ?? null, remove: async (ref) => values.delete(key(ref)), save: async (ref, secret) => { saved.push([ref, secret]); values.set(key(ref), secret); } },
    onSignedIn: async (value) => { signedIn.push(value); },
    signIn: fake.signIn,
    newFlowId: () => "flow-1",
    ...overrides,
  });
  return { handle, saved, values, signedIn, fake };
}

test("starts a Spotify sign-in, hands back the consent link, and saves only the refresh token (#135)", async () => {
  const { handle, saved, signedIn, fake } = setup();
  const started = await handle(post({ action: "start", clientId: ` ${CLIENT_ID} ` }));
  assert.equal(started.status, 200);
  assert.deepEqual(parse(started), { status: "pending", flowId: "flow-1", authUrl: `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}` });
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { status: "pending" });
  fake.calls[0].resolve({ accessToken: "at", refreshToken: "rt-secret", identity: { id: "rowan", displayName: "Rowan" } });
  await new Promise((resolve) => setImmediate(resolve));
  const done = await handle(post({ action: "poll", flowId: "flow-1" }));
  assert.deepEqual(parse(done), { status: "signed_in", provider: "spotify", identity: { id: "rowan", displayName: "Rowan" } });
  assert.doesNotMatch(done.body, /rt-secret|"at"/);
  assert.deepEqual(saved, [[{ provider: "spotify", identityId: "rowan" }, "rt-secret"]]);
  assert.deepEqual(signedIn, [{ clientId: CLIENT_ID, identity: { id: "rowan", displayName: "Rowan" } }]);
  assert.equal((await handle(post({ action: "poll", flowId: "flow-1" }))).status, 410);
});

test("rejects bad input and reports Spotify failures by code (#135)", async () => {
  const { handle, fake, saved } = setup();
  assert.deepEqual(parse(await handle(post({ action: "start", clientId: "nope" }))), { error: "bad_client_id" });
  assert.equal((await handle(post({ action: "start", clientId: CLIENT_ID, extra: 1 }))).status, 400);
  assert.equal((await handle({ method: "GET", url: "/api/setup/spotify" })).status, 405);
  assert.equal(await handle({ method: "GET", url: "/elsewhere" }), null);
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].reject(Object.assign(new Error("no"), { code: "denied" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { error: "denied" });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[1].resolve({ accessToken: "at", refreshToken: null, identity: { id: "rowan" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { error: "spotify_failed" });
  assert.deepEqual(saved, []);
});

test("only a Spotify accounts link is ever handed to the page (#135)", async () => {
  const { handle } = setup({ signIn: ({ openUrl }) => { openUrl("https://evil.example/authorize"); return new Promise(() => {}); } });
  const started = await handle(post({ action: "start", clientId: CLIENT_ID }));
  assert.deepEqual([started.status, parse(started).error], [502, "spotify_failed"]);
});

const settled = () => new Promise((resolve) => setImmediate(resolve));
const tokens = { refreshToken: "new-token", identity: { id: "rowan", displayName: "Rowan" } };

test("failed config save removes a newly acquired Spotify credential", async () => {
  const { handle, fake, values } = setup({ onSignedIn: async () => { throw Error("disk full"); } });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  const response = await handle(post({ action: "poll", flowId: "flow-1" }));
  assert.deepEqual([response.status, parse(response)], [400, { error: "draft_update_failed" }]);
  assert.equal(values.has("spotify:rowan"), false);
  assert.doesNotMatch(response.body, /new-token/);
});

test("failed repeat Spotify sign-in restores the previous credential", async () => {
  const values = new Map([["spotify:rowan", "old-token"]]);
  const fake = fakeSignIn();
  const handle = createSetupSpotifyHandler({ credentialStore: {
    read: async (ref) => values.get(`${ref.provider}:${ref.identityId}`) ?? null,
    remove: async (ref) => values.delete(`${ref.provider}:${ref.identityId}`),
    save: async (ref, secret) => { values.set(`${ref.provider}:${ref.identityId}`, secret); },
  }, onSignedIn: async () => { throw Error("draft failed"); }, signIn: fake.signIn, newFlowId: () => "flow-1" });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { error: "draft_update_failed" });
  assert.equal(values.get("spotify:rowan"), "old-token");
});

test("Spotify rollback failure does not claim the draft was the only failure", async () => {
  const fake = fakeSignIn();
  let written = false;
  const handle = createSetupSpotifyHandler({ credentialStore: {
    read: async () => null,
    save: async () => { written = true; },
    remove: async () => { throw Error("keychain unavailable"); },
  }, onSignedIn: async () => { throw Error("draft failed"); }, signIn: fake.signIn, newFlowId: () => "flow-1" });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  assert.equal(written, true);
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { error: "credential_store_failed" });
});

test("an expired Spotify completion cannot save a token or update the draft", async () => {
  let time = 0;
  const { handle, fake, saved, signedIn } = setup({ now: () => time, flowTtlMs: 1000 });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  time = 1000;
  assert.equal((await handle(post({ action: "poll", flowId: "flow-1" }))).status, 410);
  fake.calls[0].resolve(tokens);
  await settled();
  assert.deepEqual(saved, []);
  assert.deepEqual(signedIn, []);
});

test("a Spotify flow expiring while the keychain read waits cannot save a token", async () => {
  let time = 0;
  let finishRead;
  const saved = [];
  const signedIn = [];
  const fake = fakeSignIn();
  const handle = createSetupSpotifyHandler({
    now: () => time, flowTtlMs: 1000, newFlowId: () => "flow-1", signIn: fake.signIn,
    credentialStore: {
      read: () => new Promise((resolve) => { finishRead = resolve; }),
      save: async (...args) => { saved.push(args); }, remove: async () => {},
    },
    onSignedIn: async (...args) => { signedIn.push(args); },
  });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  assert.equal(typeof finishRead, "function");
  time = 1000;
  finishRead(null);
  await settled();
  assert.equal((await handle(post({ action: "poll", flowId: "flow-1" }))).status, 410);
  assert.deepEqual(saved, []);
  assert.deepEqual(signedIn, []);
});

test("Spotify expiry during credential save restores the prior token and skips the draft", async () => {
  let time = 0;
  let finishSave;
  let stored = "old-token";
  const signedIn = [];
  const fake = fakeSignIn();
  const handle = createSetupSpotifyHandler({
    now: () => time, flowTtlMs: 1000, newFlowId: () => "flow-1", signIn: fake.signIn,
    credentialStore: {
      read: async () => stored,
      save: async (_ref, secret) => {
        stored = secret;
        if (secret === "new-token") await new Promise((resolve) => { finishSave = resolve; });
      },
      remove: async () => { stored = null; },
    },
    onSignedIn: async (...args) => { signedIn.push(args); },
  });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  assert.equal(typeof finishSave, "function");
  time = 1000;
  assert.equal((await handle(post({ action: "poll", flowId: "flow-1" }))).status, 410);
  finishSave();
  await settled();
  assert.equal(stored, "old-token");
  assert.deepEqual(signedIn, []);
});

test("Spotify expiry during an in-flight draft write waits for the commit outcome", async () => {
  let time = 0;
  let finishDraft;
  const { handle, fake, saved } = setup({
    now: () => time, flowTtlMs: 1000,
    onSignedIn: () => new Promise((resolve) => { finishDraft = resolve; }),
  });
  await handle(post({ action: "start", clientId: CLIENT_ID }));
  fake.calls[0].resolve(tokens);
  await settled();
  assert.equal(typeof finishDraft, "function");
  time = 1000;
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), { status: "pending" });
  finishDraft();
  await settled();
  assert.deepEqual(parse(await handle(post({ action: "poll", flowId: "flow-1" }))), {
    status: "signed_in", provider: "spotify", identity: { id: "rowan", displayName: "Rowan" },
  });
  assert.equal(saved.length, 1);
});
