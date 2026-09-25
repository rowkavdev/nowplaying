import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_ARTWORK_URL } from "../src/discord-artwork.js";
import { createDiscordPresenceLoop } from "../src/discord-presence.js";
import { NOWPLAYING_DISCORD_CLIENT_ID, resolveDiscordClientId } from "../src/discord-app.js";
import { startDiscordFromConfig } from "../src/app-config.js";

const playing = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1000, durationMs: 60_000, updatedAt: "2026-09-23T12:00:00.000Z" };
const idle = { state: "idle" };

function fakeClient() {
  const calls = [];
  return { calls, publish: async (a) => { calls.push(a); return true; }, close: async () => { calls.push("close"); } };
}

function loop(idleBehavior, presences, extra = {}) {
  const client = fakeClient();
  let i = 0;
  const l = createDiscordPresenceLoop({ client, idleBehavior, getPresence: async () => presences[Math.min(i++, presences.length - 1)], ...extra });
  return { l, client };
}

test("publishes while playing and clears when idle by default", async () => {
  const { l, client } = loop("clear", [playing, idle]);
  assert.equal((await l.tick()).action, "publish");
  assert.equal((await l.tick()).action, "clear");
  assert.equal(client.calls.at(-1), null);
});

test("an unreachable server clears the status", async () => {
  const client = fakeClient();
  const l = createDiscordPresenceLoop({ client, getPresence: async () => { throw new Error("offline"); } });
  assert.equal((await l.tick()).action, "clear");
  assert.deepEqual(client.calls, [null]);
});

test("grace keeps the last status for the grace period, then clears", async () => {
  let t = 0;
  const { l, client } = loop("grace", [playing, idle, idle, idle], { graceMs: 1000, now: () => t });
  await l.tick();
  t = 10; assert.equal((await l.tick()).action, "grace");
  t = 900; assert.equal((await l.tick()).action, "grace");
  t = 1010; assert.equal((await l.tick()).action, "clear");
  assert.equal(client.calls.length, 2);
});

test("recent keeps what played last without a timer", async () => {
  const { l, client } = loop("recent", [playing, idle]);
  await l.tick();
  assert.equal((await l.tick()).action, "recent");
  const last = client.calls.at(-1);
  assert.ok(last && typeof last === "object");
  assert.equal(last.startTimestamp, undefined);
  assert.equal(last.endTimestamp, undefined);
});

test("show publishes a nothing-playing status", async () => {
  const { l } = loop("show", [idle]);
  assert.equal((await l.tick()).action, "publish");
});

test("stop clears Discord and closes the client", async () => {
  const client = fakeClient();
  const l = createDiscordPresenceLoop({ client, getPresence: async () => playing, setTimer: () => 1, clearTimer: () => {} });
  l.start();
  await l.stop();
  assert.deepEqual(client.calls.slice(-2), [null, "close"]);
});

test("rejects bad options", () => {
  const client = fakeClient();
  assert.throws(() => createDiscordPresenceLoop({ client }), TypeError);
  assert.throws(() => createDiscordPresenceLoop({ client, getPresence: async () => null, idleBehavior: "nope" }), TypeError);
  assert.throws(() => createDiscordPresenceLoop({ client, getPresence: async () => null, intervalMs: 10 }), RangeError);
});

test("resolveDiscordClientId uses a valid override or the built-in ID", () => {
  assert.equal(resolveDiscordClientId({ env: {} }), NOWPLAYING_DISCORD_CLIENT_ID);
  assert.match(NOWPLAYING_DISCORD_CLIENT_ID, /^\d{17,20}$/);
  assert.equal(resolveDiscordClientId({ env: {}, builtIn: "" }), null);
  assert.equal(resolveDiscordClientId({ env: {}, builtIn: "123456789012345678" }), "123456789012345678");
  assert.equal(resolveDiscordClientId({ env: { NOWPLAYING_DISCORD_CLIENT_ID: " 223456789012345678 " }, builtIn: "" }), "223456789012345678");
  assert.throws(() => resolveDiscordClientId({ env: { NOWPLAYING_DISCORD_CLIENT_ID: "abc" } }), TypeError);
});

test("startDiscordFromConfig respects setup and the app ID", async () => {
  const provider = { getPresence: async () => playing };
  assert.equal(startDiscordFromConfig({ discord: { enabled: false } }, provider, { env: {} }).status, "off");
  assert.equal(startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, provider, { env: {}, builtInClientId: "" }).status, "no_app_id");

  const calls = [];
  const transport = { connect: async () => calls.push("connect"), setActivity: async (a) => calls.push(["set", a]), clearActivity: async () => calls.push("clear"), close: async () => calls.push("close") };
  let seenId;
  const d = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, provider, {
    env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" },
    createTransport: (id) => { seenId = id; return transport; },
    intervalMs: 60_000,
  });
  assert.equal(d.status, "on");
  assert.equal(seenId, "123456789012345678");
  await d.stop();
  assert.equal(calls[0], "connect");
  assert.equal(calls.at(-1), "close");
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === "set"));
});

test("startDiscordFromConfig sends only public, token-free artwork to Discord", async () => {
  async function published(artworkUrl) {
    const sets = [];
    const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => {}, close: async () => {} };
    const provider = { getPresence: async () => ({ ...playing, ...(artworkUrl ? { artworkUrl } : {}) }) };
    const d = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, provider, {
      env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport, intervalMs: 60_000,
    });
    await d.stop();
    return sets[0]?.largeImage;
  }
  assert.equal(await published("https://images.example.com/cover.jpg"), "https://images.example.com/cover.jpg");
  assert.equal(await published("http://192.168.1.20:8096/Items/1/Images/Primary"), FALLBACK_ARTWORK_URL);
  assert.equal(await published("https://media.example.com/Items/1/Images/Primary?api_key=secret"), FALLBACK_ARTWORK_URL);
  assert.equal(await published(undefined), FALLBACK_ARTWORK_URL);
});

test("startDiscordFromConfig exposes a privacy-safe connection status", async () => {
  const transport = { connect: async () => {}, setActivity: async () => {}, clearActivity: async () => {}, close: async () => {} };
  const d = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, { getPresence: async () => playing }, {
    env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport, intervalMs: 60_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const status = d.connection();
  assert.equal(status.state, "ready");
  assert.match(status.lastPublishedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(status), /Song|Artist/);
  assert.equal(status.artwork.strategy, "fallback");
  await d.stop();
});

test("uses the saved timer setting", async () => {
  const { l, client } = loop("clear", [playing], { timestamps: "none" });
  await l.tick();
  assert.equal(client.calls[0].startTimestamp, undefined);
  assert.equal(client.calls[0].endTimestamp, undefined);
  assert.throws(() => createDiscordPresenceLoop({ client, getPresence: async () => playing, timestamps: "forever" }), TypeError);
});

test("refreshArtwork drops cached covers and republishes straight away", async () => {
  const sets = [];
  let clears = 0;
  let resolves = 0;
  const artwork = { resolve: async () => { resolves += 1; return { image: "https://images.example.com/cover.jpg", strategy: "lookup" }; }, clear: () => { clears += 1; return 3; } };
  const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => {}, close: async () => {} };
  const d = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, { getPresence: async () => playing }, {
    env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport, createArtwork: () => artwork, intervalMs: 60_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const before = resolves;
  assert.equal(await d.refreshArtwork(), 3);
  assert.equal(clears, 1);
  assert.equal(resolves, before + 1);
  await d.stop();
  assert.equal(await startDiscordFromConfig({ discord: { enabled: false } }, { getPresence: async () => playing }, { env: {} }).refreshArtwork(), 0);
});

test("a playing session whose position stops moving is cleared after stuckAfterMs", async () => {
  let time = Date.parse("2026-09-23T12:00:00.000Z");
  const client = fakeClient();
  let position = 1000;
  const l = createDiscordPresenceLoop({ client, now: () => time, stuckAfterMs: 60_000,
    getPresence: async () => ({ ...playing, positionMs: position, updatedAt: new Date(time).toISOString() }) });
  assert.equal((await l.tick()).action, "publish");
  time += 30_000; position += 30_000;
  assert.equal((await l.tick()).action, "publish");
  time += 30_000;
  assert.equal((await l.tick()).action, "publish");
  time += 29_000;
  assert.equal((await l.tick()).action, "publish");
  time += 1_000;
  assert.equal((await l.tick()).action, "clear");
  assert.equal(client.calls.at(-1), null);
  time += 15_000; position += 15_000;
  assert.equal((await l.tick()).action, "publish");
});

test("paused sessions and sessions without a position are never stuck", async () => {
  let time = Date.parse("2026-09-23T12:00:00.000Z");
  for (const extra of [{ state: "paused" }, { positionMs: undefined }]) {
    const l = createDiscordPresenceLoop({ client: fakeClient(), now: () => time, stuckAfterMs: 1_000,
      getPresence: async () => ({ ...playing, ...extra, updatedAt: new Date(time).toISOString() }) });
    await l.tick(); time += 10_000;
    assert.equal((await l.tick()).action, "publish");
  }
});

test("rejects bad stale settings", () => {
  const client = fakeClient();
  assert.throws(() => createDiscordPresenceLoop({ client, getPresence: async () => idle, stuckAfterMs: 10 }), RangeError);
  assert.throws(() => createDiscordPresenceLoop({ client, getPresence: async () => idle, stuckAfterMs: 1.5 }), RangeError);
});

test("app wiring: a stuck track cannot stay on Discord past the timeout (#153)", async () => {
  let time = Date.parse("2026-09-24T07:00:00.000Z");
  const sets = [];
  let clears = 0;
  const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => { clears += 1; }, close: async () => {} };
  // The server keeps saying "playing" at the same position after the player has gone.
  const provider = { getPresence: async () => ({ ...playing, positionMs: 42_000, updatedAt: new Date(time).toISOString() }) };
  const d = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, provider, {
    env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport,
    intervalMs: 3_600_000, stuckAfterMs: 300_000, now: () => time,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sets.length, 1);
    for (let i = 0; i < 4; i += 1) { time += 60_000; await d.refreshArtwork(); }
    assert.equal(clears, 0, "still inside the timeout after 4 minutes");
    time += 60_000;
    await d.refreshArtwork();
    assert.equal(clears, 1, "cleared once the position has been frozen for 5 minutes");
    const published = sets.length;
    time += 60_000;
    await d.refreshArtwork();
    assert.equal(sets.length, published, "not republished while it stays stuck");
  } finally {
    await d.stop();
  }
});

test("overlapping ticks publish in order, so an older poll never overwrites a newer one", async () => {
  const client = fakeClient();
  const first = { ...playing, title: "Old song" };
  const second = { ...playing, title: "New song" };
  const presences = [first, second];
  let i = 0;
  // The old song's artwork is slow (MusicBrainz miss); the new one is instant.
  const artwork = { resolve: async (p) => { if (p.title === "Old song") await new Promise((r) => setTimeout(r, 20)); return { strategy: "fallback" }; } };
  const l = createDiscordPresenceLoop({ client, artwork, getPresence: async () => presences[i++] });
  await Promise.all([l.tick(), l.tick()]);
  assert.deepEqual(client.calls.map((a) => a.details), ["Old song", "New song"]);
});

test("stop drains an in-flight tick and drops a queued tick before clearing", async () => {
  const client = fakeClient();
  let releaseFirst;
  let enteredFirst;
  const firstEntered = new Promise((resolve) => { enteredFirst = resolve; });
  const firstReleased = new Promise((resolve) => { releaseFirst = resolve; });
  let polls = 0;
  const l = createDiscordPresenceLoop({ client, getPresence: async () => {
    polls += 1;
    if (polls === 1) { enteredFirst(); await firstReleased; }
    return { ...playing, title: polls === 1 ? "Old song" : "New song" };
  } });
  const old = l.tick();
  await firstEntered;
  const queued = l.tick();
  const stopping = l.stop();
  assert.equal(client.calls.length, 0, "stop waits rather than clearing during the active poll");
  releaseFirst();
  assert.equal((await old).action, "publish");
  assert.equal((await queued).action, "stopped");
  await stopping;
  assert.equal(polls, 1, "queued work never polls after shutdown starts");
  assert.deepEqual(client.calls.map((a) => a?.details ?? (a === null ? "CLEAR" : a === "close" ? "CLOSE" : a)),
    ["Old song", "CLEAR", "CLOSE"]);
  assert.equal((await l.tick()).action, "stopped", "later manual ticks cannot publish to a closed client");
});
