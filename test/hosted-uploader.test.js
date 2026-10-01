import { streamJsonFixture } from "./helpers/stream-json-fixture.js";
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
  let elapsed = 0;
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
    const reply = (status, body) => (streamJsonFixture({ ok: status < 400, status, json: async () => body }));
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
  const credentials = { load: async () => stored, save: async (value) => { stored = value; }, clear: async () => { stored = null; }, clearIfToken: async (token) => { if (stored?.token !== token) return false; stored = null; return true; } };
  return {
    service, calls, credentials, fetchImpl, now,
    stored: () => stored,
    advance: (ms) => { clock += ms; serviceClock += ms; elapsed += ms; },
    advanceClient: (ms) => { clock += ms; },
    advanceServer: (ms) => { serviceClock += ms; },
    advanceElapsed: (ms) => { elapsed += ms; },
    setOffline: (value) => { offline = value; },
    uploader: (options = {}) => createHostedUploader({ baseUrl: BASE, credentials, fetchImpl, now, elapsedNow: () => elapsed, ...options }),
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

test("first upload and card link share one registration and credential save", async () => {
  const env = setup();
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  let saves = 0;
  const credentials = { ...env.credentials, save: async (value) => { saves++; await env.credentials.save(value); } };
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/api/register")) {
      const response = await env.fetchImpl(url, init);
      entered();
      await barrier;
      return response;
    }
    return env.fetchImpl(url, init);
  };
  const up = env.uploader({ credentials, fetchImpl });
  const push = up.push(track({ title: "Current Track" }));
  await started;
  const link = up.cardUrl();
  await Promise.resolve();
  assert.equal(env.calls.filter((call) => call.url.endsWith("/api/register")).length, 1);
  release();
  const [sent, cardUrl] = await Promise.all([push, link]);
  assert.deepEqual(sent, { sent: true });
  assert.equal(saves, 1);
  assert.equal(cardUrl, `${BASE}/card/${env.stored().cardId}.svg`);
  assert.equal((await env.service.readCardState(env.stored().cardId)).title, "Current Track");
});

test("a failed first registration or credential save clears the shared flight for retry", async () => {
  const env = setup();
  let attempts = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/api/register") && ++attempts === 1) throw new Error("offline");
    return env.fetchImpl(url, init);
  };
  const up = env.uploader({ fetchImpl });
  const [first, second] = await Promise.allSettled([up.cardUrl(), up.cardUrl()]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "rejected");
  assert.equal(attempts, 1);
  assert.equal(await up.cardUrl(), `${BASE}/card/${env.stored().cardId}.svg`);
  assert.equal(attempts, 2);

  const another = setup();
  let saves = 0;
  const credentials = { ...another.credentials, save: async (value) => {
    saves++;
    if (saves === 1) throw new Error("save failed");
    await another.credentials.save(value);
  } };
  const failingSave = another.uploader({ credentials });
  const [a, b] = await Promise.allSettled([failingSave.cardUrl(), failingSave.cardUrl()]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "rejected");
  assert.equal(saves, 1);
  const recovered = await failingSave.cardUrl();
  assert.equal(recovered, `${BASE}/card/${another.stored().cardId}.svg`);
  assert.equal(saves, 2);
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
  env.advanceClient(-60 * 60 * 1000);
  env.advanceServer(-60 * 60 * 1000);
  assert.deepEqual(await env.uploader().push(track({ title: "Temptation" })), { sent: true });
  const seqs = ingests(env.calls).map((call) => call.body.seq);
  assert.deepEqual(seqs, [firstSeq, firstSeq - 60 * 60 * 1000, firstSeq + 1]);
  assert.equal((await env.service.readCardState(cardId)).title, "Temptation");
  await assert.rejects(env.service.ingest({ token, payload: { ...ingests(env.calls)[0].body, observedAt: env.now() } }), { status: 409, code: "stale_sequence" });
});

test("a stale server without a prior sequence reports recovery unavailable", async () => {
  const env = setup();
  await env.uploader().push(track());
  env.advanceClient(-60 * 60 * 1000);
  env.advanceServer(-60 * 60 * 1000);
  const fetchImpl = async (url, init) => {
    const result = await env.fetchImpl(url, init);
    if (result.status === 409) return streamJsonFixture({ ...result, json: async () => ({ error: "stale_sequence" }) });
    return result;
  };
  const restarted = env.uploader({ fetchImpl });
  assert.deepEqual(await restarted.push(track({ title: "Temptation" })), { sent: false, reason: "sequence_recovery_unavailable" });
  assert.equal(restarted.status().lastError, "sequence_recovery_unavailable");
});

test("overlapping pushes cannot retry old playback above a newer title, idle, or redacted state", async () => {
  for (const newer of ["title", "idle", "redacted"]) {
    const env = setup();
    let entered, release;
    const held = new Promise((resolve) => { entered = resolve; });
    const barrier = new Promise((resolve) => { release = resolve; });
    let first = true;
    const fetchImpl = async (url, init) => {
      if (url.endsWith("/api/ingest") && first) {
        first = false;
        entered();
        await barrier;
      }
      return env.fetchImpl(url, init);
    };
    let settings = {};
    const up = env.uploader({ fetchImpl, settings: () => settings });
    await up.cardUrl();
    const cardId = env.stored().cardId;
    const old = up.push(track({ title: "OLD" }));
    await held;
    if (newer === "redacted") settings = { privacy: { redactTitles: true } };
    const next = newer === "idle" ? createPresence({ state: "idle" }) : track({ title: "NEW" });
    assert.deepEqual(await up.push(next), { sent: true });
    release();
    assert.deepEqual(await old, { sent: false, reason: "superseded" });
    const state = await env.service.readCardState(cardId);
    if (newer === "idle") assert.equal(state.state, "idle");
    else assert.equal(state.title, newer === "redacted" ? "Private media" : "NEW");
    assert.equal(up.status().pending, false);
    assert.equal(ingests(env.calls).length, 2, "old stale upload must not retry");
  }
});

test("a rejected old push cannot clear a newer pending update after an offline failure", async () => {
  const env = setup();
  let entered, release;
  const held = new Promise((resolve) => { entered = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  let first = true;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/api/ingest") && first) { first = false; entered(); await barrier; }
    return env.fetchImpl(url, init);
  };
  const up = env.uploader({ fetchImpl });
  await up.cardUrl();
  const old = up.push(track({ title: "OLD" }));
  await held;
  env.setOffline(true);
  assert.deepEqual(await up.push(track({ title: "NEW" })), { sent: false, reason: "network_error" });
  release();
  assert.deepEqual(await old, { sent: false, reason: "superseded" });
  assert.equal(up.status().pending, true);
  env.setOffline(false);
  env.advanceElapsed(5000);
  assert.deepEqual(await up.push(track({ title: "NEW" })), { sent: true });
  assert.equal((await env.service.readCardState(env.stored().cardId)).title, "NEW");
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

test("backoff recovers after client clock rollback and keeps the newest pending state", async () => {
  const env = setup();
  const up = env.uploader();
  await up.push(track({ title: "Old Track" }));
  const { cardId } = env.stored();
  env.advance(1000);
  env.setOffline(true);
  assert.deepEqual(await up.push(track({ title: "Failed Track" })), { sent: false, reason: "network_error" });
  const beforeRetry = ingests(env.calls).length;
  env.setOffline(false);
  env.advanceClient(-60 * 60_000);
  env.advance(4_999);
  assert.deepEqual(await up.push(track({ title: "Intermediate Track" })), { sent: false, reason: "backoff" });
  assert.equal(ingests(env.calls).length, beforeRetry);
  env.advance(1);
  assert.deepEqual(await up.push(track({ title: "New Track" })), { sent: true });
  assert.equal((await env.service.readCardState(cardId)).title, "New Track");
  assert.equal(up.status().pending, false);
  assert.equal(up.status().state, "connected");
  assert.ok(ingests(env.calls).length > beforeRetry);
  assert.equal(ingests(env.calls).at(-1).body.title, "New Track");
});

test("repeated offline failures keep exponential elapsed-time backoff", async () => {
  const env = setup();
  const up = env.uploader();
  env.setOffline(true);
  assert.equal((await up.push(track())).reason, "network_error");
  env.advanceElapsed(4_999);
  assert.equal((await up.push(track({ title: "Newest" }))).reason, "backoff");
  env.advanceElapsed(1);
  assert.equal((await up.push(track({ title: "Newest" }))).reason, "network_error");
  env.advanceElapsed(9_999);
  assert.equal((await up.push(track())).reason, "backoff");
  env.advanceElapsed(1);
  env.setOffline(false);
  assert.equal((await up.push(track({ title: "Recovered" }))).sent, true);
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

test('#834 destination mismatch and unbound legacy keys never upload, revoke or register', async () => {
  for (const baseUrl of [undefined, 'https://other.example', BASE + '/other', 'invalid']) {
    const device = { login: 'fixture', deviceId: 'd'.repeat(22), token: 't'.repeat(24), ...(baseUrl ? { baseUrl } : {}) };
    let calls = 0, clears = 0;
    const up = createHostedUploader({ baseUrl: BASE, credentials: { load: async () => device, save: async () => {}, clear: async () => { clears++; } }, fetchImpl: async () => { calls++; throw Error('must not send'); } });
    assert.equal((await up.push(track())).reason, 'credential_destination_mismatch');
    await assert.rejects(up.cardUrl(), { code: 'credential_destination_mismatch' });
    await assert.rejects(up.disconnect(), { code: 'credential_destination_mismatch' });
    assert.equal(calls, 0); assert.equal(clears, 0);
  }
});

test('#834 401 recovery does not adopt a replacement key issued by another service', async () => {
  const old = { login: 'old', deviceId: 'd'.repeat(22), token: 'a'.repeat(24), baseUrl: BASE };
  const next = { ...old, token: 'b'.repeat(24), baseUrl: 'https://other.example' };
  let stored = old; const sent = [];
  const up = createHostedUploader({ baseUrl: BASE, credentials: { load: async () => stored, save: async () => {}, clear: async () => {}, clearIfToken: async () => false }, fetchImpl: async (_url, init) => {
    sent.push(init.headers.authorization); stored = next;
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  } });
  assert.equal((await up.push(track())).reason, 'unauthorized');
  assert.equal((await up.push(track({ title: 'Next' }))).reason, 'unauthorized');
  assert.deepEqual(sent, ['Bearer ' + old.token]); assert.equal(stored, next);
});

test('disconnect never clears a replacement credential saved during revocation', async () => {
  for (const status of [200, 401]) {
    const old = { login: 'old', deviceId: 'a'.repeat(22), token: 'a'.repeat(24), baseUrl: BASE };
    const fresh = { login: 'fresh', deviceId: 'b'.repeat(22), token: 'b'.repeat(24), baseUrl: BASE };
    let stored = old, enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const credentials = { load: async () => stored, save: async value => { stored = value; }, clear: async () => { stored = null; }, clearIfToken: async token => { if (stored?.token !== token) return false; stored = null; return true; } };
    const sent = [];
    const up = createHostedUploader({ baseUrl: BASE, credentials, fetchImpl: async (url, init) => {
      sent.push({ url, token: init.headers.authorization }); enter(); await gate;
      return Response.json(status === 401 ? { error: 'unauthorized' } : {}, { status });
    } });
    const disconnect = up.disconnect(); await entered;
    await credentials.save(fresh); release();
    assert.deepEqual(await disconnect, { disconnected: true });
    assert.equal(stored, fresh);
    assert.deepEqual(sent, [{ url: BASE + '/api/revoke', token: 'Bearer ' + old.token }]);
  }
});

test('disconnect does not use an unsafe clear when conditional cleanup is unavailable', async () => {
  const device = { login: 'fixture', deviceId: 'a'.repeat(22), token: 'a'.repeat(24), baseUrl: BASE };
  let clears = 0;
  const up = createHostedUploader({ baseUrl: BASE, credentials: { load: async () => device, save: async () => {}, clear: async () => { clears++; } }, fetchImpl: async () => Response.json({}) });
  await assert.rejects(up.disconnect(), { code: 'credential_cleanup_unavailable' });
  assert.equal(clears, 0);
});
