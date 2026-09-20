import test from "node:test";
import assert from "node:assert/strict";
import { createEmbyProvider } from "../src/providers/emby.js";

test("maps an Emby episode session", async () => {
  let request;
  const provider = createEmbyProvider({
    baseUrl: "https://emby.test/", apiKey: "secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => [{
        UserName: "Rowan", PlayState: { IsPaused: true, PositionTicks: 10_000_000 },
        NowPlayingItem: { Id: "1", Type: "Episode", Name: "Pilot", SeriesName: "Show", RunTimeTicks: 30_000_000, ImageTags: { Primary: "tag" } },
      }] };
    },
  });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(request.url, "https://emby.test/Sessions");
  assert.equal(request.init.headers["X-Emby-Token"], "secret");
  assert.equal(presence.state, "paused");
  assert.equal(presence.kind, "episode");
  assert.equal(presence.title, "Pilot");
  assert.equal(presence.subtitle, "Show");
  assert.equal(presence.positionMs, 1_000);
  assert.equal(presence.durationMs, 3_000);
});

test("returns idle without active media", async () => {
  const provider = createEmbyProvider({
    baseUrl: "https://emby.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  });
  assert.equal((await provider.getPresence()).state, "idle");
});

test("surfaces Emby HTTP failures", async () => {
  const provider = createEmbyProvider({
    baseUrl: "https://emby.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized" }),
  });
  await assert.rejects(provider.getPresence(), /401 Unauthorized/);
});
