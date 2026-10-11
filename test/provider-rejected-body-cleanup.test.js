import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";
import { withProviderBackoff } from "../src/provider-backoff.js";

const paths = [
  ["Plex", createPlexProvider, { token: "fixture" }, "getPresence", "sessions"],
  ["Jellyfin", createJellyfinProvider, { apiKey: "fixture" }, "getPresence", "sessions"],
  ["Jellyfin", createJellyfinProvider, { apiKey: "fixture" }, "whoami", "user"],
  ["Emby", createEmbyProvider, { apiKey: "fixture" }, "getPresence", "sessions"],
  ["Emby", createEmbyProvider, { apiKey: "fixture" }, "whoami", "user"],
  ["Navidrome", createNavidromeProvider, { username: "fixture", token: "fixture", salt: "fixture" }, "getPresence", "now-playing"],
  ["Navidrome", createNavidromeProvider, { username: "fixture", token: "fixture", salt: "fixture" }, "whoami", "user"],
];

for (const [name, create, options, method, label] of paths) {
  for (const status of [401, 403, 503]) {
    for (const mode of ["settled", "pending", "rejecting", "throwing"]) {
      test(`${name} ${method} rejects ${status} without awaiting discard (${mode})`, async () => {
        let cancels = 0, reads = 0, timer;
        const body = new ReadableStream({
          pull() { reads++; },
          cancel() {
            cancels++;
            if (mode === "pending") return new Promise(() => {});
            if (mode === "rejecting") return Promise.reject(new Error("cleanup rejected"));
            if (mode === "throwing") throw new Error("cleanup threw");
          },
        }, { highWaterMark: 0 });
        const provider = create({ baseUrl: "http://media.fixture", ...options, fetchImpl: async () => new Response(body, { status, statusText: "Fixture status" }) });
        try {
          await assert.rejects(Promise.race([
            provider[method](),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cleanup blocked")), 150); }),
          ]), error => {
            assert.equal(error.status, status);
            assert.equal(error.message, `${name} ${label} request failed: ${status} Fixture status`);
            return true;
          });
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(cancels, 1);
          assert.equal(reads, 0);
          assert.equal(body.locked, false);
        } finally { clearTimeout(timer); }
      });
    }
  }
  test(`${name} ${method} preserves diagnostic after synchronous adapter cancel throw`, async () => {
    let cancels = 0;
    const provider = create({ baseUrl: "http://media.fixture", ...options, fetchImpl: async () => ({ ok: false, status: 503, statusText: "Fixture status", body: { cancel() { cancels++; throw new Error("cleanup"); } } }) });
    await assert.rejects(provider[method](), error => error.status === 503 && error.message === `${name} ${label} request failed: 503 Fixture status`);
    assert.equal(cancels, 1);
  });
}

for (const [name, create, options] of paths.filter(path => path[3] === "getPresence")) {
  test(`${name} polling retains backoff and retries after discarded error`, async () => {
    let requests = 0, cancels = 0, time = 0;
    const provider = withProviderBackoff(create({ baseUrl: "http://media.fixture", ...options, fetchImpl: async () => {
      requests++;
      if (requests === 1) return new Response(new ReadableStream({ cancel() { cancels++; return new Promise(() => {}); } }, { highWaterMark: 0 }), { status: 503 });
      const payload = name === "Plex" ? { MediaContainer: { Metadata: [] } } : name === "Navidrome" ? { "subsonic-response": { status: "ok", nowPlaying: { entry: [] } } } : [];
      return new Response(JSON.stringify(payload));
    } }), { elapsedNow: () => time, jitter: 0 });
    let original;
    await assert.rejects(provider.getPresence(), error => { original = error; return error.status === 503; });
    time = 4999;
    await assert.rejects(provider.getPresence(), error => error === original);
    assert.equal(requests, 1);
    assert.equal(cancels, 1);
    time = 5000;
    assert.equal((await provider.getPresence()).state, "idle");
    assert.equal(requests, 2);
    assert.equal(provider.backoff().failures, 0);
  });
}
