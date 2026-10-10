import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createAppStatus } from "../src/app-status.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";
import { startDiscordFromConfig } from "../src/app-config.js";

async function displayArtwork(source, reason) {
  const status = createAppStatus({ config: { provider: "plex" } });
  await status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "Example Song" }) }).getPresence();
  status.setDiscord(() => ({ enabled: true, state: "ready", artwork: { strategy: source, failure: reason } }));
  const handler = createStatusPageHandler({ status, fallback: async () => null });
  assert.match((await handler({ url: "/status" })).body, /id="discord-artwork-help"/);
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", className: "", hidden: false, src: "", addEventListener() {}, replaceChildren() {} });
    return nodes.get(id);
  };
  let load;
  runInNewContext((await handler({ url: "/status.js" })).body, {
    document: { getElementById: get, createElement: () => ({ textContent: "" }) },
    fetch: async () => ({ ok: true, json: async () => status.snapshot() }),
    setInterval: (fn) => { load = fn; },
  });
  await load();
  return { get, status };
}

test("Discord connection stays visible while a blocked cover upload gets an actionable warning", async () => {
  const { get, status } = await displayArtwork("fallback", "upload_blocked");
  assert.equal(get("discord-state").textContent, "Connected");
  assert.equal(get("discord-artwork").textContent, "NowPlaying icon");
  assert.equal(get("discord-artwork-help").hidden, false);
  assert.match(get("discord-artwork-help").textContent, /blocked.*Settings > Discord.*Refresh album art/);
  assert.match(get("summary").textContent, /album art needs attention/);
  assert.equal(status.diagnostics().health, "degraded");
  assert.deepEqual(status.diagnostics().discordArtwork, { source: "fallback", reason: "upload_blocked" });
});

test("successful cover sources and intentional upload opt-out have distinct status text", async () => {
  const upload = await displayArtwork("upload", null);
  assert.equal(upload.get("discord-artwork").textContent, "Server cover");
  assert.equal(upload.get("discord-artwork-help").hidden, true);
  assert.equal(upload.status.diagnostics().health, "healthy");
  const off = await displayArtwork("fallback", "upload_disabled");
  assert.match(off.get("discord-artwork-help").textContent, /enable Show my server's cover/);
  assert.equal(off.get("summary").textContent, "Everything is working.");
});

test("artwork status covers retryable failures without displaying raw values", async () => {
  for (const [reason, text] of [["upload_rate_limited", /asked NowPlaying to wait/], ["upload_timeout", /timed out/], ["upload_error", /upload failed/], ["upload_miss", /No server cover/], ["resolver_error", /couldn't be loaded/]]) {
    const { get } = await displayArtwork("fallback", reason);
    assert.match(get("discord-artwork-help").textContent, text);
  }
  const unknown = await displayArtwork("constructor", "http://secret.example/?token=private");
  assert.equal(unknown.get("discord-artwork").textContent, "Artwork status unavailable");
  assert.doesNotMatch(JSON.stringify(unknown.status.diagnostics()), /secret|private|constructor/);
});

test("an unexpected resolver failure reaches app status instead of its stale resolver status", async () => {
  const transport = { connect: async () => {}, setActivity: async () => {}, clearActivity: async () => {}, close: async () => {} };
  const discord = startDiscordFromConfig({ discord: { enabled: true, idleBehavior: "clear" } }, { getPresence: async () => ({ state: "paused", kind: "track", title: "Example Song" }) }, {
    createTransport: () => transport,
    createArtwork: () => ({ resolve: async () => { throw new Error("https://private.example/?token=secret"); }, status: () => ({ strategy: "none", failure: null }) }),
  });
  try {
    const deadline = Date.now() + 1000;
    while (discord.connection().state !== "ready") {
      assert.ok(Date.now() < deadline, "fallback should still publish");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(discord.connection().artwork, { strategy: "fallback", failure: "resolver_error" });
    const status = createAppStatus({ config: { provider: "plex" } });
    status.setDiscord(() => ({ enabled: true, ...discord.connection() }));
    assert.deepEqual(status.snapshot().discord.artwork, { source: "fallback", reason: "resolver_error" });
    assert.doesNotMatch(JSON.stringify(status.diagnostics()), /private|secret|https/);
  } finally { await discord.stop(); }
});
