import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService, createGitHubIdentity, MAX_DEVICES_PER_USER, SIGNINS_PER_HOUR, STATE_TTL_SECONDS, USER_INGESTS_PER_MINUTE } from "../hosted/lib/service.js";
import { resolveDeviceStates, currentPosition } from "../hosted/lib/resolve.js";

const GH = { gho_rowan00000000: { id: 101, login: "RowKav" }, gho_other000000000: { id: 202, login: "someone" } };

function setup(start = 1_800_000_000_000) {
  let clock = start;
  const now = () => clock;
  const redis = createMemoryRedis({ now });
  const identities = { ...GH };
  const githubUser = async (token) => { const who = identities[token]; if (!who) { const e = new Error("github_unauthorized"); e.status = 401; e.code = "github_unauthorized"; throw e; } return who; };
  const service = createService({ redis, now, githubUser });
  return { redis, service, now, identities, advance: (ms) => { clock += ms; } };
}

let n = 0;
const up = (now, extra = {}) => ({ v: 1, seq: ++n, observedAt: now, state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1000, durationMs: 200000, ...extra });
const signIn = (service, name = "Desktop", extra = {}) => service.signInWithGitHub({ githubToken: "gho_rowan00000000", deviceName: name, clientKey: `k-${Math.random()}`, ...extra });

test("sign-in gives one card per GitHub user and never stores the GitHub token", async () => {
  const { service, redis } = setup();
  const a = await signIn(service, "Desktop");
  const b = await signIn(service, "Laptop");
  assert.equal(a.cardPath, "/u/RowKav.svg");
  assert.equal(b.cardPath, a.cardPath);
  assert.notEqual(a.deviceId, b.deviceId);
  for (const [key, entry] of redis.data) {
    const text = key + String(entry.value instanceof Set ? [...entry.value].join() : entry.value);
    for (const secret of ["gho_rowan00000000", a.token, b.token]) assert.ok(!text.includes(secret), `${secret} leaked in ${key}`);
  }
  assert.equal((await service.readUserCardState("rowkav")).state, "idle");
  await assert.rejects(service.readUserCardState("nobody"), { status: 404 });
  await assert.rejects(service.readUserCardState("../x"), { status: 404 });
});

test("bad GitHub tokens are refused and sign-in is rate limited per client", async () => {
  const { service } = setup();
  await assert.rejects(service.signInWithGitHub({ githubToken: "short", clientKey: "c" }), { status: 400 });
  await assert.rejects(service.signInWithGitHub({ githubToken: "gho_unknown0000000", clientKey: "c" }), { status: 401 });
  for (let i = 2; i < SIGNINS_PER_HOUR; i += 1) await service.signInWithGitHub({ githubToken: "gho_rowan00000000", clientKey: "c" });
  await assert.rejects(service.signInWithGitHub({ githubToken: "gho_rowan00000000", clientKey: "c" }), { status: 429 });
});

test("two PCs playing at once: the one that started later wins, heartbeats don't flip it", async () => {
  const { service, now, advance } = setup();
  const desk = await signIn(service, "Desktop");
  const lap = await signIn(service, "Laptop");
  await service.ingest({ token: desk.token, payload: up(now(), { title: "Desk song" }) });
  advance(1000);
  await service.ingest({ token: lap.token, payload: up(now(), { title: "Lap song" }) });
  assert.equal((await service.readUserCardState("RowKav")).title, "Lap song");
  advance(60_000);
  await service.ingest({ token: desk.token, payload: up(now(), { title: "Desk song 2" }) }); // track change / heartbeat
  assert.equal((await service.readUserCardState("RowKav")).title, "Lap song");
  await service.ingest({ token: desk.token, payload: up(now(), { state: "paused", title: "Desk song 2" }) });
  advance(1000);
  await service.ingest({ token: desk.token, payload: up(now(), { title: "Desk again" }) }); // restarted: newest start
  assert.equal((await service.readUserCardState("RowKav")).title, "Desk again");
});

test("paused never replaces a playing PC; clear falls back to the next PC", async () => {
  const { service, now, advance } = setup();
  const desk = await signIn(service, "Desktop");
  const lap = await signIn(service, "Laptop");
  await service.ingest({ token: desk.token, payload: up(now(), { title: "Playing" }) });
  advance(1000);
  await service.ingest({ token: lap.token, payload: up(now(), { state: "paused", title: "Paused" }) });
  assert.equal((await service.readUserCardState("RowKav")).title, "Playing");
  await service.ingest({ token: desk.token, payload: up(now(), { state: "idle" }) });
  const card = await service.readUserCardState("RowKav");
  assert.equal(card.state, "paused");
  assert.equal(card.title, "Paused");
  await service.ingest({ token: lap.token, payload: up(now(), { state: "idle" }) });
  assert.equal((await service.readUserCardState("RowKav")).state, "idle");
});

test("stale PCs expire; replays are refused per device", async () => {
  const { service, now, advance } = setup();
  const desk = await signIn(service);
  const payload = up(now());
  await service.ingest({ token: desk.token, payload });
  await assert.rejects(service.ingest({ token: desk.token, payload }), { status: 409 });
  advance(STATE_TTL_SECONDS * 1000 + 1);
  assert.equal((await service.readUserCardState("RowKav")).state, "idle");
});

test("clock skew: order uses server time and progress stays in range", async () => {
  const { service, now, advance } = setup();
  const fast = await signIn(service, "Fast clock");
  const slow = await signIn(service, "Slow clock");
  await service.ingest({ token: fast.token, payload: up(now() + 110_000, { title: "Fast", positionMs: 1000 }) });
  advance(1000);
  await service.ingest({ token: slow.token, payload: up(now() - 110_000, { title: "Slow", positionMs: 1000 }) });
  const card = await service.readUserCardState("RowKav");
  assert.equal(card.title, "Slow"); // started later by the server's clock
  assert.ok(card.positionMs >= 1000 && card.positionMs <= 1000 + 5000, `position ${card.positionMs}`);
  assert.equal(currentPosition({ state: "playing", positionMs: 199_000, durationMs: 200_000, receivedAt: 0, observedAt: 0 }, 10_000), 200_000);
});

test("the 11th PC pushes out the one quiet for longest", async () => {
  const { service, now, advance } = setup();
  const pcs = [];
  for (let i = 0; i < MAX_DEVICES_PER_USER; i += 1) { pcs.push(await signIn(service, `PC ${i}`)); advance(1000); }
  for (const pc of pcs.slice(1)) await service.ingest({ token: pc.token, payload: up(now(), { state: "idle" }) });
  const extra = await signIn(service, "PC new");
  const { devices } = await service.listDevices({ token: extra.token });
  assert.equal(devices.length, MAX_DEVICES_PER_USER);
  assert.ok(!devices.some((d) => d.name === "PC 0"));
  await assert.rejects(service.ingest({ token: pcs[0].token, payload: up(now()) }), { status: 401 });
});

test("device list, rename, remove, sign out this PC and everywhere", async () => {
  const { service, now } = setup();
  const desk = await signIn(service, "Desktop<script>");
  const lap = await signIn(service, "Laptop");
  let list = (await service.listDevices({ token: desk.token })).devices;
  assert.deepEqual(list.map((d) => [d.name, d.current]), [["Desktopscript", true], ["Laptop", false]]);
  await service.renameDevice({ token: desk.token, deviceId: lap.deviceId, name: "Work laptop" });
  list = (await service.listDevices({ token: lap.token })).devices;
  assert.equal(list[1].name, "Work laptop");
  await service.ingest({ token: lap.token, payload: up(now(), { title: "Lap" }) });
  await service.removeDevice({ token: desk.token, deviceId: lap.deviceId });
  await assert.rejects(service.ingest({ token: lap.token, payload: up(now()) }), { status: 401 });
  assert.equal((await service.readUserCardState("RowKav")).state, "idle");
  const other = await service.signInWithGitHub({ githubToken: "gho_other000000000", clientKey: "o" });
  await assert.rejects(service.removeDevice({ token: other.token, deviceId: desk.deviceId }), { status: 404 });
  const third = await signIn(service, "Third");
  await service.revoke({ token: third.token });
  assert.equal((await service.listDevices({ token: desk.token })).devices.length, 1);
  await signIn(service, "Fourth");
  assert.deepEqual(await service.signOutEverywhere({ token: desk.token }), { removed: 2 });
  await assert.rejects(service.listDevices({ token: desk.token }), { status: 401 });
});

test("an old per-PC card link becomes an alias for the user's card", async () => {
  const { service, now } = setup();
  const old = await service.register({ clientKey: "legacy" });
  await service.ingest({ token: old.token, payload: up(now(), { title: "Old" }) });
  await assert.rejects(service.listDevices({ token: old.token }), { status: 403 });
  const me = await signIn(service, "Desktop", { legacyToken: old.token });
  assert.equal(me.aliasedOldCard, true);
  await assert.rejects(service.ingest({ token: old.token, payload: up(now()) }), { status: 401 });
  assert.equal((await service.readCardState(old.cardId)).state, "idle");
  await service.ingest({ token: me.token, payload: up(now(), { title: "New" }) });
  assert.equal((await service.readCardState(old.cardId)).title, "New");
  assert.equal((await service.readUserCardState("RowKav")).title, "New");
});

test("a GitHub rename moves the card URL to the new login", async () => {
  const { service, identities } = setup();
  await signIn(service);
  identities.gho_rowan00000000 = { id: 101, login: "RowanK" };
  const again = await signIn(service);
  assert.equal(again.cardPath, "/u/RowanK.svg");
  await assert.rejects(service.readUserCardState("RowKav"), { status: 404 });
  assert.equal((await service.readUserCardState("rowank")).state, "idle");
});

test("per-user ingest limit covers all of a user's PCs together", async () => {
  const { service, now } = setup();
  const pcs = [await signIn(service, "a"), await signIn(service, "b"), await signIn(service, "c")];
  let accepted = 0;
  for (let i = 0; i < USER_INGESTS_PER_MINUTE + 5; i += 1) {
    try { await service.ingest({ token: pcs[i % 3].token, payload: up(now()) }); accepted += 1; } catch (e) { assert.equal(e.status, 429); }
  }
  assert.equal(accepted, USER_INGESTS_PER_MINUTE);
});

test("resolver ignores idle/garbage and breaks ties deterministically", () => {
  assert.equal(resolveDeviceStates([null, { state: "idle" }]), null);
  const w = resolveDeviceStates([{ deviceId: "b", state: "playing", startedAt: 5, receivedAt: 9 }, { deviceId: "a", state: "playing", startedAt: 5, receivedAt: 9 }]);
  assert.equal(w.deviceId, "a");
  assert.equal(resolveDeviceStates([{ deviceId: "p", state: "paused", receivedAt: 100 }, { deviceId: "q", state: "paused", receivedAt: 50 }]).deviceId, "p");
});

test("GitHub identity check sends the token only to api.github.com and maps errors", async () => {
  const calls = [];
  const ok = createGitHubIdentity({ fetchImpl: async (url, init) => { calls.push([url, init.headers.authorization, init.redirect]); return { ok: true, status: 200, json: async () => ({ id: 7, login: "octo", email: "x@y" }) }; } });
  assert.deepEqual(await ok("gho_abcdefghij"), { id: 7, login: "octo" });
  assert.deepEqual(calls, [["https://api.github.com/user", "Bearer gho_abcdefghij", "error"]]);
  await assert.rejects(createGitHubIdentity({ fetchImpl: async () => ({ ok: false, status: 401 }) })("t"), { status: 401 });
  await assert.rejects(createGitHubIdentity({ fetchImpl: async () => { throw new Error("down"); } })("t"), { status: 502 });
  await assert.rejects(createGitHubIdentity({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: "7", login: "octo" }) }) })("t"), { status: 502 });
});
