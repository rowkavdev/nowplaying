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

test("whoami reads the signed-in Jellyfin user from /Users/Me", async () => {
  let seen;
  const provider = createJellyfinProvider({
    baseUrl: "https://media.test/", apiKey: "token",
    fetchImpl: async (url, options) => { seen = { url: String(url), token: options.headers["X-Emby-Token"] }; return { ok: true, json: async () => ({ Id: "abc", Name: "Rowan", Policy: { IsAdministrator: true } }) }; },
  });
  assert.deepEqual(await provider.whoami(), { id: "abc", displayName: "Rowan" });
  assert.deepEqual(seen, { url: "https://media.test/Users/Me", token: "token" });
});

function oneJellyfinItem(item) {
  return createJellyfinProvider({
    baseUrl: "https://jellyfin.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => [{ UserName: "Rowan", PlayState: {}, NowPlayingItem: { Id: "1", ...item } }] }),
  });
}

test("maps Jellyfin episode series, season, episode and year", async () => {
  const presence = await oneJellyfinItem({ Type: "Episode", Name: "The Constant", SeriesName: "Lost", SeasonName: "Season 4", ParentIndexNumber: 4, IndexNumber: 5, ProductionYear: 2008 }).getPresence();
  assert.equal(presence.series, "Lost");
  assert.equal(presence.season, 4);
  assert.equal(presence.episode, 5);
  assert.equal(presence.year, 2008);
});

test("maps Jellyfin movie year only", async () => {
  const presence = await oneJellyfinItem({ Type: "Movie", Name: "Arrival", ProductionYear: 2016, IndexNumber: 2 }).getPresence();
  assert.equal(presence.year, 2016);
  assert.equal(presence.series, null);
  assert.equal(presence.episode, null);
});

test("drops odd Jellyfin numbers instead of failing", async () => {
  const presence = await oneJellyfinItem({ Type: "Episode", Name: "Special", SeriesName: "", ParentIndexNumber: -1, IndexNumber: 2.5, ProductionYear: 3000 }).getPresence();
  assert.equal(presence.series, null);
  assert.equal(presence.season, null);
  assert.equal(presence.episode, null);
  assert.equal(presence.year, null);
});

test("HTTP authentication failures carry a safe status for sign-in guidance", async () => {
  const { classifyFailure } = await import("../src/resilient-card.js");
  for (const status of [401, 403, 503]) {
    const provider = createJellyfinProvider({ baseUrl: "http://jellyfin.test", apiKey: "secret", fetchImpl: async () => ({ ok: false, status, statusText: status === 503 ? "Unavailable" : "Rejected" }) });
    await assert.rejects(provider.getPresence(), (error) => {
      assert.equal(error.status, status);
      assert.equal(classifyFailure(error), status === 503 ? "error" : "unauthorized");
      return true;
    });
  }
});
