import test from "node:test";
import assert from "node:assert/strict";

import { createPresence } from "../src/presence.js";
import { createHostedUploader, normalizeHostedUrl, HEARTBEAT_MS } from "../src/hosted-uploader.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService, ServiceError } from "../hosted/lib/service.js";

const BASE = "https://cards.example.test";

// Routes the uploader's fetch calls straight into the real service, so these
// tests exercise the actual ingest contract (schema, seq, auth).
function setup({ start = 1_800_000_000_000 } = {}) {
  let clock = start;
  let serviceClock = start;
  const now = () => clock;
  const serverNow = () => serviceClock;
  const redis = createMemoryRedis({ now: serverNow });
  const service = createService({ redis, now: serverNow });
  const calls = [];
  let offline = false;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (offline) throw new TypeError("fetch failed");
    const path = new URL(url).pathname;
    const token = /^Bearer (.+)$/.exec(init.headers.authorization ?? "")?.[1];
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    try {
      if (path === "/api/register") return reply(201, await service.register({ clientKey: "test" }));
      if (path === "/api/ingest") return reply(202, await service.ingest({ token, payload: JSON.parse(init.body) }));
      if (path === "/api/revoke") return reply(200, await service.revoke({ token }));
      return reply(404, { error: "not_found" });
    } catch (error) {
      if (error instanceof ServiceError) return reply(error.status, { error: error.code, ...error.details });
      throw error;
    }
  };
  let stored = null;
  const credentials = { load: async () => stored, save: async (value) => { stored = value; }, clear: async () => { stored = null; } };
  return {
    service, calls, credentials, fetchImpl, now,
    stored: () => stored,
    advance: (ms) => { clock += ms; serviceClock += ms; },
    advanceClient: (ms) => { clock += ms; },
    advanceServer: (ms) => { serviceClock += ms; },
    setOffline: (value) => { offline = value; },
    uploader: (options = {}) => createHostedUploader({ baseUrl: BASE, credentials, fetchImpl, now, ...options }),
  };
}

const track = (extra = {}) => createPresence({ state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", artworkUrl: "http://10.0.0.2/art?api_key=secret", positionMs: 60_000, durationMs: 447_000, ...extra });
const ingests = (calls) => calls.filter((call) => call.url.endsWith("/api/ingest"));

test("registers once, stores the device credentials and pushes state", async () => {
  const env = setup();
  const up = env.uploader();
  assert.deepEqual(await up.push(track()), { sent: true });
  assert.equal(env.calls.filter((call) => call.url.endsWith("/api/register")).length, 1);
  const saved = env.stored();
  assert.match(saved.cardId, /^[A-Za-z0-9_-]{22}$/);
  const state = await env.service.readCardState(saved.cardId);
  assert.equal(state.title, "Blue Monday");
  assert.equal(await up.cardUrl(), `${BASE}/card/${saved.cardId}.svg`);
  assert.equal(up.status().state, "connected");
});

test("reuses stored credentials instead of registering again", async () => {
  const env = setup();
  await env.uploader().push(track());
  env.advance(1000);
  await env.uploader().push(track({ title: "Temptation" }));
  assert.equal(env.calls.filter((call) => call.url.endsWith("/api/register")).length, 1);
});

test("only sends on change or heartbeat, not every progress tick", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  env.advance(5_000);
  assert.deepEqual(await up.push(track({ positionMs: 65_000 })), { sent: false, reason: "unchanged" });
  env.advance(1_000);
  assert.equal((await up.push(track({ state: "paused", positionMs: 66_000 }))).sent, true);
  env.advance(HEARTBEAT_MS);
  assert.equal((await up.push(track({ state: "paused", positionMs: 66_000 }))).sent, true);
  assert.equal(ingests(env.calls).length, 3);
});

test("a seek resends state", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  env.advance(5_000);
  assert.equal((await up.push(track({ positionMs: 200_000 }))).sent, true);
});

test("idle is sent once and clears the card", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  env.advance(1000);
  assert.equal((await up.push(createPresence({ state: "idle" }))).sent, true);
  env.advance(HEARTBEAT_MS * 2);
  assert.equal((await up.push(createPresence({ state: "idle" }))).sent, false);
  assert.equal((await env.service.readCardState(env.stored().cardId)).state, "idle");
});

test("sequence keeps rising across restarts", async () => {
  const env = setup();
  await env.uploader().push(track());
  env.advance(10);
  assert.equal((await env.uploader().push(track())).sent, true);
  const seqs = ingests(env.calls).map((call) => call.body.seq);
  assert.ok(seqs[1] > seqs[0]);
});

test("recovers a rollback across restarts using the authenticated prior sequence", async () => {
  const env = setup();
  assert.deepEqual(await env.uploader().push(track()), { sent: true });
  const { cardId, token } = env.stored();
  const firstSeq = ingests(env.calls)[0].body.seq;
  env.advance(-60 * 60 * 1000);
  assert.deepEqual(await env.uploader().push(track({ title: "Temptation" })), { sent: true });
  const seqs = ingests(env.calls).map((call) => call.body.seq);
  assert.deepEqual(seqs, [firstSeq, firstSeq - 60 * 60 * 1000, firstSeq + 1]);
  assert.equal((await env.service.readCardState(cardId)).title, "Temptation");
  await assert.rejects(env.service.ingest({ token, payload: { ...ingests(env.calls)[0].body, observedAt: env.now() } }), { status: 409, code: "stale_sequence" });
});

test("a stale server without a prior sequence reports recovery unavailable", async () => {
  const env = setup();
  await env.uploader().push(track());
  env.advance(-60 * 60 * 1000);
  const fetchImpl = async (url, init) => {
    const result = await env.fetchImpl(url, init);
    if (result.status === 409) return { ...result, json: async () => ({ error: "stale_sequence" }) };
    return result;
  };
  const restarted = env.uploader({ fetchImpl });
  assert.deepEqual(await restarted.push(track({ title: "Temptation" })), { sent: false, reason: "sequence_recovery_unavailable" });
  assert.equal(restarted.status().lastError, "sequence_recovery_unavailable");
});

test("paused card heartbeat survives a client-only hour rollback without per-poll uploads", async () => {
  const env = setup();
  const up = env.uploader();
  const paused = track({ state: "paused", title: "Still Playing" });
  assert.deepEqual(await up.push(paused), { sent: true });
  const { cardId, token } = env.stored();
  env.advanceClient(-60 * 60 * 1000);
  for (let minute = 1; minute <= 11; minute++) {
    env.advance(60_000);
    const result = await up.push(paused);
    assert.equal(result.sent, minute === 1 || minute === 5 || minute === 9, `minute ${minute}`);
    assert.equal((await env.service.readCardState(cardId)).state, "paused", `minute ${minute}`);
  }
  const accepted = ingests(env.calls).filter((call) => Math.abs(call.body.observedAt - 1_800_000_000_000) < 12 * 60_000 && call.body.seq > 1_800_000_000_000);
  assert.equal(accepted.length, 3);
  assert.ok(accepted.every((call, i) => i === 0 || call.body.seq > accepted[i - 1].body.seq));
  assert.equal(up.status().state, "connected");
  await assert.rejects(env.service.ingest({ token, payload: { ...accepted[0].body, observedAt: 1_800_000_000_000 + 11 * 60_000 } }), { code: "stale_sequence" });
});

test("disabled card fields and artwork never reach the wire", async () => {
  const env = setup();
  const up = env.uploader({ settings: { show: { subtitle: false, progress: false } } });
  await up.push(track());
  const wire = JSON.stringify(ingests(env.calls));
  for (const needle of ["New Order", "api_key", "secret", "10.0.0.2", "positionMs"]) assert.equal(wire.includes(needle), false, needle);
});

test("backs off when offline and sends only the newest state after", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  env.setOffline(true);
  env.advance(1000);
  const failed = await up.push(track({ title: "Ceremony" }));
  assert.equal(failed.reason, "network_error");
  assert.equal(up.status().state, "retrying");
  assert.equal(up.status().pending, true);
  env.setOffline(false);
  env.advance(1000);
  assert.equal((await up.push(track({ title: "Regret" }))).reason, "backoff");
  env.advance(10_000);
  assert.equal((await up.push(track({ title: "Regret" }))).sent, true);
  assert.equal((await env.service.readCardState(env.stored().cardId)).title, "Regret");
  assert.equal(up.status().pending, false);
});

test("a revoked token stops uploads and clears credentials", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  await env.service.revoke({ token: env.stored().token });
  env.advance(1000);
  assert.equal((await up.push(track({ title: "Isolation" }))).reason, "unauthorized");
  assert.equal(env.stored(), null);
  assert.equal(up.status().state, "unauthorized");
});

test("disconnect revokes on the service and forgets the device", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track());
  const { cardId } = env.stored();
  assert.deepEqual(await up.disconnect(), { disconnected: true });
  assert.equal(env.stored(), null);
  assert.equal((await env.service.readCardState(cardId)).state, "idle");
  assert.equal(env.calls.at(-1).method, "DELETE");
});

test("only talks to the configured origin and never follows redirects", async () => {
  const env = setup();
  let redirect;
  const up = env.uploader({ fetchImpl: async (url, init) => { redirect = init.redirect; return env.fetchImpl(url, init); } });
  await up.push(track());
  assert.equal(redirect, "error");
  assert.ok(env.calls.every((call) => call.url.startsWith(`${BASE}/api/`)));
});

test("hosted URL must be HTTPS without credentials or query", () => {
  assert.equal(normalizeHostedUrl("https://cards.example.test/"), "https://cards.example.test");
  assert.equal(normalizeHostedUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const bad of ["http://cards.example.test", "https://u:p@cards.example.test", "https://cards.example.test/?x=1", "nope"]) {
    assert.throws(() => normalizeHostedUrl(bad), TypeError, bad);
  }
});

test("offline disconnect keeps the revocation key, blocks uploads, then retry revokes the old token", async () => {
  const env = setup(); const up = env.uploader();
  await up.push(track({ title: "Sensitive Track" }));
  const { cardId, token } = env.stored();
  env.setOffline(true);
  await assert.rejects(up.disconnect(), { code: "network_error" });
  assert.equal(env.stored().token, token, "protected revocation key must survive offline failure");
  assert.deepEqual(up.status(), { state: "disconnect_pending", lastError: "network_error", lastSuccessAt: null, pending: false });
  assert.deepEqual(await up.push(track({ title: "New Track" })), { sent: false, reason: "disconnect_pending" });
  assert.equal(await up.cardUrl(), null, "must not register a replacement card during pending deletion");
  assert.equal((await env.service.readCardState(cardId)).title, "Sensitive Track", "remote deletion is not complete");
  env.setOffline(false);
  assert.deepEqual(await up.disconnect(), { disconnected: true });
  assert.equal(env.stored(), null);
  assert.equal((await env.service.readCardState(cardId)).state, "idle");
  await assert.rejects(env.service.ingest({ token, payload: { state: "idle", seq: 1, observedAt: env.now() } }), (error) => error.status === 401);
});

test("already-revoked hosted key is cleared without re-registering", async () => {
  const env = setup(); const up = env.uploader();
  await up.push(track());
  const token = env.stored().token;
  await env.service.revoke({ token });
  assert.deepEqual(await up.disconnect(), { disconnected: true });
  assert.equal(env.stored(), null);
  assert.equal(env.calls.filter((c) => c.url.endsWith("/api/register")).length, 1);
});
