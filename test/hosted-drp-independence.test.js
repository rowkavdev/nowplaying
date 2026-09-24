import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

// #140 done-when: Discord Rich Presence keeps working with hosted upload
// turned off, or turned on while the hosted service is unreachable.
const JELLYFIN = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "a1b2c3d4-0000-0000-0000-000000000001", displayName: "Rowan" }, credentialStored: true };
const SESSIONS = [{ UserId: "a1b2c3d4000000000000000000000001", UserName: "Rowan", NowPlayingItem: { Type: "Audio", Name: "Local Only", Artists: ["A"], Album: "B", RunTimeTicks: 1_800_000_000 }, PlayState: { IsPaused: false, PositionTicks: 100_000_000 } }];

async function run({ hostedEnabled }) {
  const dir = await mkdtemp(join(tmpdir(), "np-drp-hosted-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ ...JELLYFIN, hostedEnabled }));
  const hostedCalls = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === "127.0.0.1") return Response.json(SESSIONS);
    hostedCalls.push(u.origin);
    throw new TypeError("fetch failed"); // hosted service offline
  };
  let saved = null;
  const hostedCredentials = { load: async () => saved, save: async (v) => { saved = v; }, clear: async () => { saved = null; } };
  const sets = [];
  const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => {}, close: async () => {} };
  const app = await startAppFromConfig({
    configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl, hostedCredentials,
    discord: { env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport },
  });
  try {
    for (let i = 0; i < 50 && (sets.length === 0 || (hostedEnabled && hostedCalls.length === 0)); i += 1) await new Promise((r) => setTimeout(r, 20));
    return { sets, hostedCalls };
  } finally {
    await app.close();
  }
}

test("Discord shows the track with hosted upload off, and never calls the host", async () => {
  const { sets, hostedCalls } = await run({ hostedEnabled: false });
  assert.ok(sets.length >= 1, "Discord got an activity");
  assert.match(JSON.stringify(sets[0]), /Local Only/);
  assert.deepEqual(hostedCalls, []);
});

test("Discord shows the track while the hosted service is offline", async () => {
  const { sets, hostedCalls } = await run({ hostedEnabled: true });
  assert.ok(hostedCalls.length >= 1, "the app tried the hosted service");
  assert.ok(sets.length >= 1, "Discord got an activity anyway");
  assert.match(JSON.stringify(sets[0]), /Local Only/);
});
