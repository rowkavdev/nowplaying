import test from "node:test";
import assert from "node:assert/strict";
import { advanceSetupDraft, createSetupDraft, previousSetupDraft, serializeSetupDraft } from "../src/setup.js";

test("starts with privacy-first, testable defaults", () => {
  assert.deepEqual(createSetupDraft(), {
    version: 1,
    step: "welcome",
    provider: null,
    discordEnabled: true,
    discordIdleBehavior: "clear",
  });
});

test("advances one resumable setup step at a time", () => {
  const provider = advanceSetupDraft(createSetupDraft(), { provider: "plex" });
  assert.equal(provider.step, "provider");
  assert.equal(provider.provider, "plex");
  assert.equal(advanceSetupDraft(provider).step, "discord");
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
