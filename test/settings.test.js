

import test from "node:test";
import assert from "node:assert/strict";

import { createSettings, defaultSettings, validateSettings } from "../src/settings.js";

test("creates immutable defaults", () => {
  const settings = createSettings();

  assert.deepEqual(settings, defaultSettings);
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(Object.isFrozen(settings.card.show), true);
  assert.equal(settings.privacy.mode, "public");
  assert.equal(settings.discord.enabled, false);
});

test("deep-merges supported sections without mutating defaults", () => {
  const settings = createSettings({
    locale: "en-US",
    privacy: { mode: "friends", hideArtwork: true },
    card: { width: 560, show: { subtitle: false } },
    discord: { enabled: true, timestamps: "none" },
  });

  assert.equal(settings.locale, "en-US");
  assert.equal(settings.privacy.mode, "friends");
  assert.equal(settings.privacy.hideUsers, true);
  assert.equal(settings.privacy.hideArtwork, true);
  assert.equal(settings.card.width, 560);
  assert.equal(settings.card.show.mediaType, true);
  assert.equal(settings.card.show.subtitle, false);
  assert.equal(settings.discord.enabled, true);
  assert.equal(settings.discord.timestamps, "none");
  assert.equal(defaultSettings.card.width, 420);
});

test("accepts all documented enum values", () => {
  for (const mode of ["private", "friends", "public", "custom"]) {
    assert.doesNotThrow(() => validateSettings({ privacy: { mode } }));
  }
  for (const timestamps of ["elapsed", "remaining", "both", "none"]) {
    assert.doesNotThrow(() => validateSettings({ discord: { timestamps } }));
  }
  for (const idleBehavior of ["clear", "grace", "show", "recent"]) {
    assert.doesNotThrow(() => validateSettings({ discord: { idleBehavior } }));
  }
});

test("rejects unknown settings with a stable path", () => {
  assert.throws(
    () => validateSettings({ privacy: { hideUser: true } }),
    { message: "privacy.hideUser: unknown setting" },
  );
  assert.throws(
    () => validateSettings({ card: { show: { title: true } } }),
    { message: "card.show.title: unknown setting" },
  );
  assert.throws(
    () => validateSettings({ debug: true }),
    { message: "settings.debug: unknown setting" },
  );
});

test("rejects invalid nested values", () => {
  assert.throws(
    () => validateSettings({ card: { width: 100 } }),
    { message: "card.width: must be an integer between 280 and 800" },
  );
  assert.throws(
    () => validateSettings({ card: { theme: "unsafe-css" } }),
    { message: "card.theme: expected midnight-blue, paper or compact" },
  );
  assert.throws(
    () => validateSettings({ discord: { enabled: "yes" } }),
    { message: "discord.enabled: expected a boolean" },
  );
  assert.throws(
    () => validateSettings({ privacy: null }),
    { message: "privacy: expected an object" },
  );
});

test("rejects oversized Discord templates", () => {
  assert.throws(
    () => validateSettings({ discord: { details: "x".repeat(129) } }),
    { message: "discord.details: expected a string between 0 and 128 characters" },
  );
});
