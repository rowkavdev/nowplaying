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
  const signedIn = [];
  const fake = fakeSignIn();
  const handle = createSetupSpotifyHandler({
    credentialStore: { save: async (ref, secret) => { saved.push([ref, secret]); } },
    onSignedIn: async (value) => { signedIn.push(value); },
    signIn: fake.signIn,
    newFlowId: () => "flow-1",
    ...overrides,
  });
  return { handle, saved, signedIn, fake };
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
