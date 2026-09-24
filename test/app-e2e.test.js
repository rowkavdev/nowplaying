// Cross-cutting end-to-end checks (0.2 QA): start the real app from a saved
// config, feed it a media-server fixture, and check the local card and the
// Discord activity together. Only the network edges are faked: the media
// server (fetchImpl) and the Discord IPC transport.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const CLIENT_ID = "123456789012345678";
const TICKS_PER_MS = 10_000;

async function configFile(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "np-e2e-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true, ...extra }));
  return file;
}

const store = { read: async (ref) => (ref.provider === "jellyfin" && ref.identityId === "u1" ? "jf-token" : null) };

function track({ paused = false } = {}) {
  return { UserId: "u1", PlayState: { IsPaused: paused, PositionTicks: 30_000 * TICKS_PER_MS }, NowPlayingItem: { Id: "t1", Type: "Audio", Name: "Night Drive", Artists: ["The Fixtures"], Album: "Test Album", RunTimeTicks: 180_000 * TICKS_PER_MS } };
}

function episode() {
  return { UserId: "u1", PlayState: { IsPaused: false, PositionTicks: 60_000 * TICKS_PER_MS }, NowPlayingItem: { Id: "e1", Type: "Episode", Name: "Pilot", SeriesName: "Fixture Show", ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 1_800_000 * TICKS_PER_MS } };
}

// A fake media server whose sessions can be swapped mid-test. Artwork
// requests fail so the card falls back cleanly without real images.
function server(initial) {
  let sessions = initial;
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/Sessions")) return Response.json(sessions);
    return new Response("no art", { status: 404 });
  };
  return { fetchImpl, set: (next) => { sessions = next; } };
}

// Discord allows one update per 15 s, so the clock is movable: tests jump it
// forward instead of sleeping.
function discordSpy() {
  const events = [];
  let offset = 0;
  const transport = {
    connect: async () => events.push({ op: "connect" }),
    setActivity: async (activity) => events.push({ op: "set", activity }),
    clearActivity: async () => events.push({ op: "clear" }),
    close: async () => events.push({ op: "close" }),
  };
  return { events, sets: () => events.filter((e) => e.op === "set").map((e) => e.activity), advance: (ms) => { offset += ms; }, options: { env: {}, builtInClientId: CLIENT_ID, createTransport: () => transport, intervalMs: 1000, now: () => Date.now() + offset } };
}

async function until(check, what, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("e2e: a playing track reaches the card and Discord from one app start", async () => {
  const media = server([track()]);
  const discord = discordSpy();
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: store, port: 0, fetchImpl: media.fetchImpl, discord: discord.options });
  try {
    const svg = await (await fetch(`${app.url}/card.svg`)).text();
    assert.match(svg, />Night Drive</);
    assert.match(svg, /The Fixtures/);
    const activity = await until(() => discord.sets()[0], "a Discord activity");
    const text = JSON.stringify(activity);
    assert.match(text, /Night Drive/);
    assert.match(text, /The Fixtures/);
    assert.equal(activity.type, "listening", "music shows as Listening");
    assert.doesNotMatch(text, /jf-token|127\.0\.0\.1:8096/, "no token or server address reaches Discord");
    assert.doesNotMatch(svg, /jf-token|127\.0\.0\.1:8096/, "no token or server address reaches the card");
  } finally {
    await app.close();
  }
  assert.equal(discord.events.at(-1).op, "close", "closing the app closes the Discord connection");
});

test("e2e: an episode shows as Watching on Discord and on the card", async () => {
  const media = server([episode()]);
  const discord = discordSpy();
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: store, port: 0, fetchImpl: media.fetchImpl, discord: discord.options });
  try {
    const svg = await (await fetch(`${app.url}/card.svg`)).text();
    assert.match(svg, /Pilot/);
    const activity = await until(() => discord.sets()[0], "a Discord activity");
    assert.equal(activity.type, "watching", "TV shows as Watching");
    assert.match(JSON.stringify(activity), /Fixture Show|Pilot/);
  } finally {
    await app.close();
  }
});

test("e2e: redacted titles are hidden on both the card and Discord", async () => {
  const media = server([track()]);
  const discord = discordSpy();
  const app = await startAppFromConfig({ configFile: await configFile({ privacy: { redactTitles: true } }), credentialStore: store, port: 0, fetchImpl: media.fetchImpl, discord: discord.options });
  try {
    const svg = await (await fetch(`${app.url}/card.svg`)).text();
    assert.doesNotMatch(svg, /Night Drive|The Fixtures|Test Album/);
    const activity = await until(() => discord.sets()[0], "a Discord activity");
    assert.doesNotMatch(JSON.stringify(activity), /Night Drive|The Fixtures|Test Album/);
  } finally {
    await app.close();
  }
});

test("e2e: when playback stops, Discord clears and the card goes idle", async () => {
  const media = server([track()]);
  const discord = discordSpy();
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: store, port: 0, fetchImpl: media.fetchImpl, discord: discord.options });
  try {
    await until(() => discord.sets()[0], "a Discord activity");
    media.set([]);
    discord.advance(16_000);
    await until(() => discord.events.some((e) => e.op === "clear"), "Discord to clear");
    const svg = await (await fetch(`${app.url}/card.svg`)).text();
    assert.doesNotMatch(svg, /Night Drive/);
  } finally {
    await app.close();
  }
});

test("e2e: Discord turned off in setup never opens a Discord connection, and the card still works", async () => {
  const media = server([track()]);
  const discord = discordSpy();
  const app = await startAppFromConfig({ configFile: await configFile({ discordEnabled: false }), credentialStore: store, port: 0, fetchImpl: media.fetchImpl, discord: discord.options });
  try {
    assert.match(await (await fetch(`${app.url}/card.svg`)).text(), />Night Drive</);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(discord.events, []);
  } finally {
    await app.close();
  }
});
