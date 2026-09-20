import test from "node:test";
import assert from "node:assert/strict";

import { createPresence } from "../src/presence.js";
import {
  applyPrivacy,
  createPrivacyPolicy,
  privacyDefaults,
  validatePrivacyPolicy,
} from "../src/privacy.js";

const playing = createPresence({
  state: "playing",
  kind: "episode",
  title: "Private Episode",
  subtitle: "Private Show",
  artworkUrl: "https://media.example.test/art/1",
  positionMs: 30_000,
  durationMs: 60_000,
  updatedAt: "2026-09-20T12:00:00.000Z",
});

test("creates immutable privacy defaults", () => {
  const policy = createPrivacyPolicy();
  assert.deepEqual(policy, privacyDefaults);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.suppressMediaKinds), true);
});

test("redacts titles and removes related context", () => {
  const safe = applyPrivacy(playing, { redactTitles: true, titleReplacement: "Watching media" });
  assert.equal(safe.title, "Watching media");
  assert.equal(safe.subtitle, null);
  assert.equal(safe.artworkUrl, playing.artworkUrl);
});

test("removes artwork and progress independently", () => {
  const safe = applyPrivacy(playing, { hideArtwork: true, hideProgress: true });
  assert.equal(safe.title, playing.title);
  assert.equal(safe.artworkUrl, null);
  assert.equal(safe.positionMs, null);
  assert.equal(safe.durationMs, null);
});

test("private mode returns idle without title data", () => {
  const safe = applyPrivacy(playing, { mode: "private" });
  assert.equal(safe.state, "idle");
  assert.equal(safe.kind, "unknown");
  assert.equal(safe.title, null);
  assert.equal(safe.updatedAt, playing.updatedAt);
});

test("suppresses selected media kinds", () => {
  const safe = applyPrivacy(playing, { suppressMediaKinds: ["episode"] });
  assert.equal(safe.state, "idle");
});

test("keeps the input immutable and returns a new presence", () => {
  const safe = applyPrivacy(playing, {});
  assert.notEqual(safe, playing);
  assert.deepEqual(safe, playing);
  assert.equal(Object.isFrozen(safe), true);
});

test("rejects unknown and invalid policy values", () => {
  assert.throws(
    () => validatePrivacyPolicy({ revealTokens: true }),
    { message: "privacy.revealTokens: unknown setting" },
  );
  assert.throws(
    () => validatePrivacyPolicy({ suppressMediaKinds: ["book"] }),
    { message: "privacy.suppressMediaKinds: unknown media kind book" },
  );
  assert.throws(
    () => validatePrivacyPolicy({ hideProgress: "yes" }),
    { message: "privacy.hideProgress: expected a boolean" },
  );
});
