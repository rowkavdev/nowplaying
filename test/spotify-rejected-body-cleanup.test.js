import test from "node:test";
import assert from "node:assert/strict";
import { createSpotifyProvider } from "../src/providers/spotify.js";
import { withProviderBackoff } from "../src/provider-backoff.js";

for (const status of [401, 429, 503]) {
  for (const mode of ["settled", "pending", "rejecting", "throwing"]) {
    test(`Spotify ${status} discards unread body without waiting (${mode})`, async () => {
      let cancels = 0, pulls = 0, forgets = 0, timer;
      const body = new ReadableStream({
        pull() { pulls++; },
        cancel() {
          cancels++;
          if (mode === "pending") return new Promise(() => {});
          if (mode === "rejecting") return Promise.reject(new Error("cleanup rejected"));
          if (mode === "throwing") throw new Error("cleanup threw");
        },
      }, { highWaterMark: 0 });
      const provider = createSpotifyProvider({
        getAccessToken: async () => "private-token",
        forgetAccessToken: () => { forgets++; },
        fetchImpl: async () => new Response(body, { status, headers: { "retry-after": "7" } }),
      });
      try {
        await assert.rejects(Promise.race([
          provider.getPresence(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cleanup blocked")), 150); }),
        ]), error => {
          assert.equal(error.message, `Spotify now-playing request failed: ${status}`);
          assert.equal(error.status, status);
          assert.equal(error.retryAfterMs, status === 429 ? 7000 : undefined);
          return true;
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(cancels, 1);
        assert.equal(pulls, 0);
        assert.equal(body.locked, false);
        assert.equal(forgets, status === 401 ? 1 : 0);
      } finally { clearTimeout(timer); }
    });
  }
}

test("synchronous adapter cancellation throw preserves Spotify diagnostic", async () => {
  let cancels = 0;
  const provider = createSpotifyProvider({
    getAccessToken: async () => "private-token",
    fetchImpl: async () => ({ status: 503, ok: false, body: { cancel() { cancels++; throw new Error("cleanup"); } } }),
  });
  await assert.rejects(provider.getPresence(), error => error.status === 503 && error.message === "Spotify now-playing request failed: 503");
  assert.equal(cancels, 1);
});

test("429 cleanup retains backoff suppression and recovery", async () => {
  let requests = 0, cancels = 0, now = 0;
  const provider = withProviderBackoff(createSpotifyProvider({
    getAccessToken: async () => "private-token",
    fetchImpl: async () => {
      requests++;
      if (requests > 1) return new Response(null, { status: 204 });
      return new Response(new ReadableStream({ cancel() { cancels++; return new Promise(() => {}); } }, { highWaterMark: 0 }), { status: 429, headers: { "retry-after": "7" } });
    },
  }), { elapsedNow: () => now, jitter: 0 });
  let original;
  await assert.rejects(provider.getPresence(), error => { original = error; return error.retryAfterMs === 7000; });
  now = 6999;
  await assert.rejects(provider.getPresence(), error => error === original);
  assert.equal(requests, 1);
  assert.equal(cancels, 1);
  now = 7000;
  assert.equal((await provider.getPresence()).state, "idle");
  assert.equal(requests, 2);
  assert.equal(provider.backoff().failures, 0);
});

test("successful playback reads normally and does not cancel", async () => {
  let cancels = 0, pulls = 0;
  const payload = { currently_playing_type: "track", is_playing: true, item: { name: "Song", artists: [{ name: "Artist" }], duration_ms: 1000 }, progress_ms: 500 };
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(JSON.stringify(payload))); controller.close(); },
    cancel() { cancels++; },
  }, { highWaterMark: 0 });
  const provider = createSpotifyProvider({ getAccessToken: async () => "private-token", fetchImpl: async () => new Response(body) });
  const presence = await provider.getPresence();
  assert.equal(presence.title, "Song");
  assert.equal(presence.state, "playing");
  assert.equal(presence.positionMs, 500);
  assert.equal(pulls, 1);
  assert.equal(cancels, 0);
  assert.equal(body.locked, false);
});
