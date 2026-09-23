import test from "node:test";
import assert from "node:assert/strict";
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
