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

test("whoami reads the signed-in Emby user from /Users/Me", async () => {
  let seen;
  const provider = createEmbyProvider({
    baseUrl: "https://media.test/", apiKey: "token",
    fetchImpl: async (url, options) => { seen = { url: String(url), token: options.headers["X-Emby-Token"] }; return { ok: true, json: async () => ({ Id: "abc", Name: "Rowan", Policy: { IsAdministrator: true } }) }; },
  });
  assert.deepEqual(await provider.whoami(), { id: "abc", displayName: "Rowan" });
  assert.deepEqual(seen, { url: "https://media.test/Users/Me", token: "token" });
});

function oneEmbyItem(item) {
  return createEmbyProvider({
    baseUrl: "https://emby.test", apiKey: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => [{ UserName: "Rowan", PlayState: {}, NowPlayingItem: { Id: "1", ...item } }] }),
  });
}

test("maps Emby episode series, season, episode and year", async () => {
  const presence = await oneEmbyItem({ Type: "Episode", Name: "The Constant", SeriesName: "Lost", SeasonName: "Season 4", ParentIndexNumber: 4, IndexNumber: 5, ProductionYear: 2008 }).getPresence();
  assert.equal(presence.series, "Lost");
  assert.equal(presence.season, 4);
  assert.equal(presence.episode, 5);
  assert.equal(presence.year, 2008);
});

test("maps Emby movie year only", async () => {
  const presence = await oneEmbyItem({ Type: "Movie", Name: "Arrival", ProductionYear: 2016, IndexNumber: 2 }).getPresence();
  assert.equal(presence.year, 2016);
  assert.equal(presence.series, null);
  assert.equal(presence.episode, null);
});

test("drops odd Emby numbers instead of failing", async () => {
  const presence = await oneEmbyItem({ Type: "Episode", Name: "Special", SeriesName: "", ParentIndexNumber: -1, IndexNumber: 2.5, ProductionYear: 3000 }).getPresence();
  assert.equal(presence.series, null);
  assert.equal(presence.season, null);
  assert.equal(presence.episode, null);
  assert.equal(presence.year, null);
});

test("HTTP authentication failures carry a safe status for sign-in guidance", async () => {
  const { classifyFailure } = await import("../src/resilient-card.js");
  for (const status of [401, 403, 503]) {
    const provider = createEmbyProvider({ baseUrl: "http://emby.test", apiKey: "secret", fetchImpl: async () => ({ ok: false, status, statusText: status === 503 ? "Unavailable" : "Rejected" }) });
    await assert.rejects(provider.getPresence(), (error) => {
      assert.equal(error.status, status);
      assert.equal(classifyFailure(error), status === 503 ? "error" : "unauthorized");
      return true;
    });
  }
});
