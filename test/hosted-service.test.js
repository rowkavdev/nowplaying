import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis, createUpstashRedis } from "../hosted/lib/redis.js";
import { createService, validateIngest, STATE_TTL_SECONDS, REGISTRATIONS_PER_HOUR, INGESTS_PER_MINUTE, DAY_STATS_TTL_SECONDS } from "../hosted/lib/service.js";

function setup(start = 1_800_000_000_000) {
  let clock = start;
  const now = () => clock;
  const redis = createMemoryRedis({ now });
  const service = createService({ redis, now });
  return { redis, service, now, advance: (ms) => { clock += ms; } };
}

const update = (now, extra = {}) => ({ v: 1, seq: 1, observedAt: now, state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1000, durationMs: 200000, ...extra });

test("register returns opaque ids and stores only a token hash", async () => {
  const { redis, service } = setup();
  const { cardId, deviceId, token } = await service.register({ clientKey: "1.2.3.4" });
  assert.match(cardId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(deviceId, /^[A-Za-z0-9_-]{22}$/);
  for (const [key, entry] of redis.data) {
    assert.ok(!key.includes(token), "token must not appear in keys");
    assert.ok(!entry.value.includes(token), "token must not appear in values");
  }
});

test("registration is rate limited per client", async () => {
  const { service } = setup();
  for (let i = 0; i < REGISTRATIONS_PER_HOUR; i += 1) await service.register({ clientKey: "a" });
  await assert.rejects(service.register({ clientKey: "a" }), { status: 429 });
  await service.register({ clientKey: "b" });
});

test("ingest then read returns the pushed state with derived progress", async () => {
  const { service, now, advance } = setup();
  const { cardId, token } = await service.register();
  await service.ingest({ token, payload: update(now()) });
  advance(5000);
  const state = await service.readCardState(cardId);
  assert.equal(state.state, "playing");
  assert.equal(state.title, "Song");
  assert.equal(state.positionMs, 6000);
});

test("ingest rejects bad tokens, replays and out-of-order sequences", async () => {
  const { service, now } = setup();
  const { token } = await service.register();
  await assert.rejects(service.ingest({ token: "x".repeat(43), payload: update(now()) }), { status: 401 });
  await assert.rejects(service.ingest({ token: null, payload: update(now()) }), { status: 401 });
  await service.ingest({ token, payload: update(now(), { seq: 5 }) });
  await assert.rejects(service.ingest({ token, payload: update(now(), { seq: 5 }) }), { status: 409 });
  await assert.rejects(service.ingest({ token, payload: update(now(), { seq: 4 }) }), { status: 409 });
});

test("validation rejects unknown fields, skew, oversize text and bad times", () => {
  const now = 1_800_000_000_000;
  assert.throws(() => validateIngest({ ...update(now), artworkUrl: "http://x" }, { now }), { code: "unknown_field" });
  assert.throws(() => validateIngest({ ...update(now), serverUrl: "http://lan" }, { now }), { code: "unknown_field" });
  assert.throws(() => validateIngest(update(now - 600_000), { now }), { code: "clock_skew" });
  assert.throws(() => validateIngest(update(now, { title: "a".repeat(201) }), { now }), { code: "invalid_text" });
  assert.throws(() => validateIngest(update(now, { positionMs: 5, durationMs: 1 }), { now }), { code: "invalid_time" });
  assert.throws(() => validateIngest(update(now, { v: 2 }), { now }), { code: "unsupported_version" });
  assert.throws(() => validateIngest(update(now, { state: "offline" }), { now }), { code: "invalid_state" });
});

test("state expires into idle instead of showing stale media", async () => {
  const { service, now, advance } = setup();
  const { cardId, token } = await service.register();
  await service.ingest({ token, payload: update(now()) });
  advance(STATE_TTL_SECONDS * 1000 + 1);
  const state = await service.readCardState(cardId);
  assert.equal(state.state, "idle");
  assert.equal(state.title, null);
});

test("idle clears state and revoke invalidates the token", async () => {
  const { service, now } = setup();
  const { cardId, token } = await service.register();
  await service.ingest({ token, payload: update(now()) });
  await service.ingest({ token, payload: update(now(), { seq: 2, state: "idle", title: null, subtitle: null }) });
  assert.equal((await service.readCardState(cardId)).state, "idle");
  await service.ingest({ token, payload: update(now(), { seq: 3 }) });
  await service.revoke({ token });
  assert.equal((await service.readCardState(cardId)).state, "idle");
  await assert.rejects(service.ingest({ token, payload: update(now(), { seq: 4 }) }), { status: 401 });
});

test("unknown card ids 404 and counters stay aggregate", async () => {
  const { service, redis } = setup();
  await assert.rejects(service.readCardState("../etc"), { status: 404 });
  const { cardId } = await service.register();
  await service.readCardState(cardId);
  await service.readCardState(cardId);
  assert.equal(redis.data.get("np:stats:cards_rendered").value, "2");
  assert.equal(redis.data.get("np:stats:registrations").value, "1");
});

test("daily counters are aggregate, expire, and never hold device ids", async () => {
  const { service, redis, now } = setup();
  const day = new Date(now()).toISOString().slice(0, 10);
  const a = await service.register();
  const b = await service.register();
  await service.ingest({ token: a.token, payload: update(now(), { seq: 1 }) });
  await service.ingest({ token: a.token, payload: update(now(), { seq: 2 }) });
  await service.ingest({ token: b.token, payload: update(now(), { seq: 1 }) });
  await service.readCardState(a.cardId);
  await service.readCardState(b.cardId);
  await service.readCardState(b.cardId);
  assert.equal(redis.data.get(`np:stats:day:${day}:renders`).value, "3");
  assert.equal(redis.data.get(`np:stats:day:${day}:registrations`).value, "2");
  assert.equal(await redis.command(["PFCOUNT", `np:stats:day:${day}:devices`]), 2);
  for (const metric of ["renders", "registrations", "devices"]) {
    assert.equal(redis.data.get(`np:stats:day:${day}:${metric}`).expiresAt, now() + DAY_STATS_TTL_SECONDS * 1000);
  }
  const members = [...redis.data.get(`np:stats:day:${day}:devices`).value];
  for (const id of [a.deviceId, b.deviceId, a.cardId, b.cardId]) assert.ok(!members.some((m) => m.includes(id)));
});

test("a failing stats write never fails the card, ingest or registration", async () => {
  const { redis, now } = setup();
  const failing = { command: async (args) => {
    if (String(args[1] ?? "").startsWith("np:stats:day:")) throw new Error("redis down");
    return redis.command(args);
  } };
  const service = createService({ redis: failing, now });
  const { token, cardId } = await service.register();
  assert.equal((await service.ingest({ token, payload: update(now()) })).accepted, true);
  assert.equal((await service.readCardState(cardId)).state, "playing");
});

test("upstash client posts commands with bearer auth and hides error bodies", async () => {
  const calls = [];
  const redis = createUpstashRedis({ url: "https://example.upstash.io/", token: "t0k", fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ result: "OK" }) }; } });
  assert.equal(await redis.command(["SET", "k", "v"]), "OK");
  assert.equal(calls[0].url, "https://example.upstash.io");
  assert.equal(calls[0].init.headers.authorization, "Bearer t0k");
  assert.deepEqual(JSON.parse(calls[0].init.body), ["SET", "k", "v"]);
  const failing = createUpstashRedis({ url: "https://example.upstash.io", token: "t", fetchImpl: async () => ({ ok: true, json: async () => ({ error: "secret detail" }) }) });
  await assert.rejects(failing.command(["GET", "k"]), (error) => !error.message.includes("secret"));
  assert.throws(() => createUpstashRedis({ url: "http://insecure", token: "t" }), TypeError);
});

test("ingest is rate limited per device and resets each minute", async () => {
  const alignToMinute = (ts) => ts - (ts % 60_000);
  const { service, redis, now, advance } = setup(alignToMinute(1_800_000_000_000));
  const first = await service.register({ clientKey: "one" });
  const second = await service.register({ clientKey: "two" });
  let seq = 0;
  for (let i = 0; i < INGESTS_PER_MINUTE; i += 1) await service.ingest({ token: first.token, payload: update(now(), { seq: ++seq }) });
  await assert.rejects(service.ingest({ token: first.token, payload: update(now(), { seq: ++seq }) }), { status: 429, code: "rate_limited" });
  await service.ingest({ token: second.token, payload: update(now(), { seq: 1 }) });
  for (const [key, entry] of redis.data) if (key.startsWith("np:rl:ingest:")) assert.ok(entry.expiresAt !== null, "rate limit buckets always expire");
  advance(60_000);
  await service.ingest({ token: first.token, payload: update(now(), { seq: ++seq }) });
});

test("a bad token is rejected before it counts against any limit", async () => {
  const { service, redis, now } = setup();
  await assert.rejects(service.ingest({ token: "x".repeat(43), payload: update(now()) }), { status: 401 });
  assert.equal([...redis.data.keys()].some((key) => key.startsWith("np:rl:ingest:")), false);
});
