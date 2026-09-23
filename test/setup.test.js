import test from "node:test";
import assert from "node:assert/strict";
import { advanceSetupDraft, createSetupDraft, previousSetupDraft, serializeSetupDraft } from "../src/setup.js";

test("starts with privacy-first, testable defaults", () => {
  assert.deepEqual(createSetupDraft(), {
    version: 1,
    step: "welcome",
    provider: null,
    account: null,
    discordEnabled: true,
    discordIdleBehavior: "clear",
    startWithWindows: null,
  });
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
