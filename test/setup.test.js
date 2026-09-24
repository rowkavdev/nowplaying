import test from "node:test";
import assert from "node:assert/strict";
import { addAnotherServer, advanceSetupDraft, cancelAddServer, createSetupDraft, previousSetupDraft, removeSetupServer, serializeSetupDraft, setupAccounts } from "../src/setup.js";

test("starts with privacy-first, testable defaults", () => {
  assert.deepEqual(createSetupDraft(), {
    version: 1,
    step: "welcome",
    provider: null,
    account: null,
    servers: [],
    spotify: null,
    discordEnabled: true,
    discordIdleBehavior: "clear",
    discordArtworkLookup: true,
    startWithWindows: null,
  });
});

test("album art lookup is on by default and must be a boolean", () => {
  assert.equal(createSetupDraft({ discordArtworkLookup: false }).discordArtworkLookup, false);
  assert.throws(() => createSetupDraft({ discordArtworkLookup: "yes" }), /discordArtworkLookup is invalid/);
});

test("advances one resumable setup step at a time", () => {
  const provider = advanceSetupDraft(createSetupDraft(), { provider: "plex" });
  assert.equal(provider.step, "provider");
  assert.equal(provider.provider, "plex");
  const signin = advanceSetupDraft(provider);
  assert.equal(signin.step, "signin");
  assert.throws(() => advanceSetupDraft(signin), { name: "SetupStepError", code: "signin_required" });
  const signedIn = createSetupDraft({ ...signin, account: { provider: "plex", id: "1", displayName: "Rowan" } });
  assert.equal(advanceSetupDraft(signedIn).step, "discord");
  assert.equal(previousSetupDraft(advanceSetupDraft(signedIn)).step, "signin");
});

test("skips the sign-in step when sign-in is unavailable", () => {
  const provider = createSetupDraft({ step: "provider", provider: "emby" });
  const discord = advanceSetupDraft(provider, {}, { signIn: false });
  assert.equal(discord.step, "discord");
  assert.equal(previousSetupDraft(discord, { signIn: false }).step, "provider");
});

test("keeps only an account that matches the chosen server, and never a secret", () => {
  const account = { provider: "jellyfin", id: "u1", displayName: "Rowan" };
  assert.deepEqual(createSetupDraft({ provider: "jellyfin", account }).account, account);
  assert.equal(createSetupDraft({ provider: "plex", account }).account, null);
  for (const bad of [{ ...account, token: "s3cret" }, { ...account, id: "" }, { ...account, provider: "other" }, { ...account, displayName: "x".repeat(201) }, "u1", [account]]) {
    assert.throws(() => createSetupDraft({ provider: "jellyfin", account: bad }), /account is invalid/);
  }
});

test("serialized setup state never accepts credentials", () => {
  assert.throws(() => createSetupDraft({ provider: "plex", token: "secret" }), /cannot contain credentials/);
  assert.throws(() => createSetupDraft({ credential: "secret" }), /cannot contain credentials/);
  assert.equal(serializeSetupDraft({ provider: "jellyfin" }).includes("secret"), false);
});

test("rejects invalid provider and step values", () => {
  assert.throws(() => createSetupDraft({ provider: "other" }), /provider is invalid/);
  assert.throws(() => createSetupDraft({ step: "terminal" }), /step is invalid/);
});


test("round-trips a draft before a provider is chosen", () => {
  const welcome = createSetupDraft();
  assert.deepEqual(createSetupDraft(welcome), welcome);
  assert.equal(advanceSetupDraft(welcome).step, "provider");
  assert.deepEqual(createSetupDraft(JSON.parse(serializeSetupDraft(welcome))), welcome);
});

test("steps back without losing choices and stops at welcome", () => {
  const discord = advanceSetupDraft(advanceSetupDraft(createSetupDraft()), { provider: "emby" });
  const back = previousSetupDraft(discord);
  assert.equal(back.step, "provider");
  assert.equal(back.provider, "emby");
  assert.equal(previousSetupDraft(createSetupDraft()).step, "welcome");
});

test("rejects invalid Discord choices", () => {
  assert.throws(() => createSetupDraft({ discordEnabled: "yes" }), /discordEnabled is invalid/);
  assert.throws(() => createSetupDraft({ discordIdleBehavior: "explode" }), /discordIdleBehavior is invalid/);
});

test("add another server keeps the signed-in account and goes back to the server choice (#252)", () => {
  const nav = { provider: "navidrome", id: "rowan", displayName: "Rowan", serverUrl: "http://127.0.0.1:4533" };
  const jf = { provider: "jellyfin", id: "u1", displayName: "Rowan" };
  assert.throws(() => addAnotherServer(createSetupDraft({ step: "signin", provider: "navidrome" })), /signin_required/);
  const second = addAnotherServer(createSetupDraft({ step: "signin", provider: "navidrome", account: nav }));
  assert.deepEqual([second.step, second.provider, second.account, second.servers], ["provider", null, null, [nav]]);
  const both = createSetupDraft({ ...second, provider: "jellyfin", account: jf });
  assert.deepEqual(setupAccounts(both), [nav, jf]);
  // Signing the same account in again doesn't list it twice.
  assert.deepEqual(setupAccounts(createSetupDraft({ ...second, provider: "navidrome", account: nav })), [nav]);
  assert.deepEqual(removeSetupServer(both, { provider: "navidrome", id: "rowan" }).servers, []);
  assert.throws(() => removeSetupServer(both, { provider: "plex", id: "x" }), /server_not_found/);
});

test("setup server list is capped, deduped and accounts-only (#252)", () => {
  const account = (i) => ({ provider: "plex", id: `u${i}`, displayName: `User ${i}` });
  const full = createSetupDraft({ step: "signin", provider: "plex", account: account(7), servers: [0, 1, 2, 3, 4, 5, 6].map(account) });
  assert.throws(() => addAnotherServer(full), /too_many_servers/);
  assert.throws(() => createSetupDraft({ servers: [0, 1, 2, 3, 4, 5, 6, 7].map(account) }), /servers is invalid/);
  assert.throws(() => createSetupDraft({ servers: [account(1), account(1)] }), /servers is invalid/);
  assert.throws(() => createSetupDraft({ servers: [{ ...account(1), token: "x" }] }), /servers is invalid/);
  assert.throws(() => createSetupDraft({ servers: "plex" }), /servers is invalid/);
});

test("cancelling an added server puts the last one back as the signed-in account (#252)", () => {
  const nav = { provider: "navidrome", id: "rowan", displayName: "Rowan" };
  const adding = addAnotherServer(createSetupDraft({ step: "signin", provider: "navidrome", account: nav }));
  const back = cancelAddServer(adding);
  assert.deepEqual([back.step, back.provider, back.account, back.servers], ["signin", "navidrome", nav, []]);
  assert.throws(() => cancelAddServer(back), /nothing_to_cancel/);
  assert.throws(() => cancelAddServer(createSetupDraft({ step: "provider" })), /nothing_to_cancel/);
});

test("the draft keeps an optional Spotify sign-in, identity only (#135)", () => {
  const spotify = { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "rowan", displayName: "Rowan" } };
  assert.deepEqual(createSetupDraft({ spotify }).spotify, spotify);
  assert.throws(() => createSetupDraft({ spotify: { ...spotify, refreshToken: "x" } }), /spotify is invalid/);
  assert.throws(() => createSetupDraft({ spotify: { ...spotify, clientId: "short" } }), /spotify is invalid/);
  assert.throws(() => createSetupDraft({ spotify: { clientId: spotify.clientId, identity: { id: "" , displayName: "x" } } }), /spotify is invalid/);
});
