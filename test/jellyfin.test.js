import test from "node:test";
import assert from "node:assert/strict";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";

test("maps a Jellyfin audio session", async () => {
  let request;
  const provider = createJellyfinProvider({
    baseUrl: "https://jellyfin.test/", apiKey: "secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => [{
        UserName: "Rowan", PlayState: { IsPaused: false, PositionTicks: 20_000_000 },
        NowPlayingItem: { Id: "1", Type: "Audio", Name: "Song", Artists: ["Artist"], RunTimeTicks: 40_000_000, ImageTags: { Primary: "tag" } },
      }] };
    },
  });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(request.url, "https://jellyfin.test/Sessions");
  assert.equal(request.init.headers["X-Emby-Token"], "secret");
  assert.equal(presence.kind, "track");
  assert.equal(presence.title, "Song");
  assert.equal(presence.subtitle, "Artist");
  assert.equal(presence.positionMs, 2_000);
  assert.equal(presence.durationMs, 4_000);
});

test("ignores sessions without current media", async () => {
  const provider = createJellyfinProvider({
    baseUrl: "https://jellyfin.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => [{ UserName: "Rowan" }] }),
  });
  assert.equal((await provider.getPresence()).state, "idle");
});

test("surfaces Jellyfin HTTP failures", async () => {
  const provider = createJellyfinProvider({
    baseUrl: "https://jellyfin.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: false, status: 403, statusText: "Forbidden" }),
  });
  await assert.rejects(provider.getPresence(), /403 Forbidden/);
});
