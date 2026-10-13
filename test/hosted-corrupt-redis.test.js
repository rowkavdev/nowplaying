import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";

function setup(start = 1_800_000_000_000) {
  let clock = start;
  const now = () => clock;
  const redis = createMemoryRedis({ now });
  const githubUser = async () => ({ id: 42, login: "newlogin" });
  const service = createService({ redis, now, githubUser });
  return { redis, service, now };
}

const update = (now, extra = {}) => ({ v: 1, seq: 1, observedAt: now, state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1000, durationMs: 200000, ...extra });

const corrupt = (redis, prefix, value = "{not json") => {
  const key = [...redis.data.keys()].find((k) => k.startsWith(prefix));
  assert.ok(key, `expected a ${prefix} entry`);
  redis.data.set(key, { value, expiresAt: null });
  return key;
};

test("a corrupt token entry rejects as unauthorized instead of throwing", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:");
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a token entry holding valid JSON of the wrong shape also rejects as unauthorized", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:", JSON.stringify("just a string"));
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a token entry with an empty object rejects as unauthorized", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:", "{}");
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a token entry with a blank deviceId rejects as unauthorized", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:", JSON.stringify({ deviceId: "" }));
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a token entry with malformed ids rejects as unauthorized", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:", JSON.stringify({ cardId: "x", deviceId: "y" }));
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a token entry with extra keys beyond the two supported shapes rejects as unauthorized", async () => {
  const { redis, service, now } = setup();
  const { token } = await service.register({ clientKey: "1.2.3.4" });
  corrupt(redis, "np:tok:", JSON.stringify({ cardId: "a".repeat(22), deviceId: "b".repeat(22), userId: "42" }));
  await assert.rejects(service.ingest({ token, payload: update(now()) }), { status: 401, code: "unauthorized" });
});

test("a corrupt card state renders idle instead of throwing", async () => {
  const { redis, service, now } = setup();
  const { cardId, token } = await service.register();
  await service.ingest({ token, payload: update(now()) });
  corrupt(redis, "np:state:");
  const state = await service.readCardState(cardId);
  assert.equal(state.state, "idle");
  assert.equal(state.title, null);
});

test("a corrupt user record fails sign-in closed without account, mapping or token writes", async () => {
  const { redis, service } = setup();
  redis.data.set("np:user:42", { value: "{not json", expiresAt: null });
  await assert.rejects(service.signInWithGitHub({ githubToken: "gho_abcdefghij" }), { status: 409, code: "account_needs_repair" });
  assert.equal(redis.data.has("np:login:newlogin"), false);
  assert.equal([...redis.data.keys()].some((k) => k.startsWith("np:tok:")), false);
  // The corrupt record is left for manual repair, not overwritten.
  assert.equal(redis.data.get("np:user:42").value, "{not json");
});

test("a user record with valid JSON but no valid login fails sign-in closed", async () => {
  const { redis, service } = setup();
  redis.data.set("np:user:42", { value: JSON.stringify({ createdAt: 1 }), expiresAt: null });
  await assert.rejects(service.signInWithGitHub({ githubToken: "gho_abcdefghij" }), { status: 409, code: "account_needs_repair" });
});

test("a corrupt user record leaves the old public handle mapping unchanged for manual repair", async () => {
  const { redis, service } = setup();
  // User 42 was "oldlogin"; the public mapping for that handle still exists.
  redis.data.set("np:login:oldlogin", { value: "42", expiresAt: null });
  redis.data.set("np:user:42", { value: "{not json", expiresAt: null });
  // Sign-in must refuse rather than proceed as a new user, which would leave
  // np:login:oldlogin pointing at the account with no cleanup path.
  await assert.rejects(service.signInWithGitHub({ githubToken: "gho_abcdefghij" }), { status: 409, code: "account_needs_repair" });
  assert.equal(redis.data.get("np:login:oldlogin").value, "42");
  assert.equal(redis.data.has("np:login:newlogin"), false);
});

test("a corrupt legacy token is skipped, not aliased, on sign-in", async () => {
  const { redis, service } = setup();
  const { token: legacyToken } = await service.register();
  corrupt(redis, "np:tok:");
  const result = await service.signInWithGitHub({ githubToken: "gho_abcdefghij", legacyToken });
  assert.equal(result.aliasedOldCard, false);
  assert.equal([...redis.data.keys()].some((k) => k.startsWith("np:alias:")), false);
});
