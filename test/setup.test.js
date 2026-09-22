import test from "node:test";
import assert from "node:assert/strict";
import { advanceSetupDraft, createSetupDraft, serializeSetupDraft } from "../src/setup.js";

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
