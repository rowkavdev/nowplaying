import test from "node:test";
import assert from "node:assert/strict";

import { createPresence } from "../src/presence.js";
import { projectHostedState, HOSTED_TEXT_LIMIT } from "../src/hosted-projection.js";
import { validateIngest } from "../hosted/lib/service.js";

const NOW = Date.parse("2026-09-23T22:00:00.000Z");
const playing = createPresence({
  state: "playing",
  kind: "track",
  title: "Blue Monday",
  subtitle: "New Order",
  artwork: { provider: "jellyfin", itemId: "item-123", type: "primary" },
  artworkUrl: "http://192.168.1.10:8096/Items/item-123/Images/Primary?api_key=secret",
  positionMs: 61_000.7,
  durationMs: 447_000,
  updatedAt: "2026-09-23T21:59:59.000Z",
});

const SENSITIVE = ["item-123", "192.168.1.10", "api_key", "secret", "jellyfin", "artwork"];

function wire(payload) {
  return JSON.stringify(payload);
}

test("projects a playing track into a payload the hosted service accepts", () => {
  const payload = projectHostedState(playing, {}, { seq: 7, now: NOW });
  assert.deepEqual(payload, { v: 1, seq: 7, observedAt: NOW, state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", durationMs: 447_000, positionMs: 61_000 });
  assert.doesNotThrow(() => validateIngest(payload, { now: NOW }));
});

test("never sends artwork, provider or server details", () => {
  const text = wire(projectHostedState(playing, {}, { seq: 1, now: NOW }));
  for (const needle of SENSITIVE) assert.equal(text.includes(needle), false, needle);
});

test("fields turned off for the card never leave the process", () => {
  const payload = projectHostedState(playing, { show: { subtitle: false, progress: false, mediaType: false } }, { seq: 2, now: NOW });
  assert.deepEqual(payload, { v: 1, seq: 2, observedAt: NOW, state: "playing", kind: "unknown", title: "Blue Monday" });
  const text = wire(payload);
  for (const needle of ["New Order", "61000", "447000", "track"]) assert.equal(text.includes(needle), false, needle);
});

test("privacy redaction applies before upload", () => {
  const payload = projectHostedState(playing, { privacy: { redactTitles: true, hideProgress: true } }, { seq: 3, now: NOW });
  assert.equal(payload.title, "Private media");
  assert.equal("subtitle" in payload, false);
  assert.equal("positionMs" in payload, false);
  assert.equal(wire(payload).includes("Blue Monday"), false);
});

test("private mode and suppressed kinds upload an idle state only", () => {
  for (const privacy of [{ mode: "private" }, { suppressMediaKinds: ["track"] }]) {
    const payload = projectHostedState(playing, { privacy }, { seq: 4, now: NOW });
    assert.deepEqual(payload, { v: 1, seq: 4, observedAt: NOW, state: "idle" });
  }
});

test("offline and idle presence become idle", () => {
  for (const state of ["idle", "offline"]) {
    const payload = projectHostedState(createPresence({ state, title: "Leftover" }), {}, { seq: 5, now: NOW });
    assert.deepEqual(payload, { v: 1, seq: 5, observedAt: NOW, state: "idle" });
  }
});

test("long text is clipped to the service limit", () => {
  const long = createPresence({ state: "paused", kind: "episode", title: "x".repeat(500), subtitle: "é".repeat(300) });
  const payload = projectHostedState(long, {}, { seq: 6, now: NOW });
  assert.equal(payload.title.length, HOSTED_TEXT_LIMIT);
  assert.equal(payload.subtitle.length, HOSTED_TEXT_LIMIT);
  const emoji = projectHostedState(createPresence({ state: "playing", title: "a" + "🎵".repeat(150) }), {}, { seq: 7, now: NOW });
  assert.ok(emoji.title.length <= HOSTED_TEXT_LIMIT);
  assert.equal(emoji.title.length, 199);
  assert.doesNotThrow(() => validateIngest(emoji, { now: NOW }));
  assert.doesNotThrow(() => validateIngest(payload, { now: NOW }));
});

test("rejects a missing or bad sequence number", () => {
  assert.throws(() => projectHostedState(playing, {}, { now: NOW }), TypeError);
  assert.throws(() => projectHostedState(playing, {}, { seq: -1, now: NOW }), TypeError);
});
