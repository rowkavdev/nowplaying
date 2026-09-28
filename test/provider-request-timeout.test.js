import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout } from "../src/providers/request.js";
import { createPlexProvider } from "../src/providers/plex.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";
import { createSpotifyProvider } from "../src/providers/spotify.js";

// A server that accepts the connection and never answers. Real fetch rejects
// when the signal aborts; this fake does the same.
function hangingFetch(seen = []) {
  return (url, init = {}) => {
    seen.push(init.signal);
    return new Promise((_, reject) => {
      // AbortSignal.timeout's timer is unref'd; keep the test's loop alive
      // the way the app's own poll timers do.
      const alive = setTimeout(() => {}, 5_000);
      init.signal?.addEventListener("abort", () => { clearTimeout(alive); reject(init.signal.reason); });
    });
  };
}

test("a request that never answers fails with ETIMEDOUT instead of hanging", async () => {
  await assert.rejects(fetchWithTimeout(hangingFetch(), "http://stuck.test", {}, 20), (error) => {
    assert.equal(error.code, "ETIMEDOUT");
    assert.match(error.message, /timed out/);
    return true;
  });
});

test("other fetch failures pass through unchanged", async () => {
  const failure = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  await assert.rejects(fetchWithTimeout(async () => { throw failure; }, "http://down.test"), (error) => error === failure);
});

test("every provider request carries a deadline", async () => {
  const providers = [
    (fetchImpl) => createPlexProvider({ baseUrl: "http://plex.test", token: "t", fetchImpl }),
    (fetchImpl) => createJellyfinProvider({ baseUrl: "http://jf.test", apiKey: "k", fetchImpl }),
    (fetchImpl) => createEmbyProvider({ baseUrl: "http://emby.test", apiKey: "k", fetchImpl }),
    (fetchImpl) => createNavidromeProvider({ baseUrl: "http://nd.test", username: "u", token: "t", salt: "s", fetchImpl }),
    (fetchImpl) => createSpotifyProvider({ getAccessToken: async () => "a", fetchImpl }),
  ];
  for (const make of providers) {
    const seen = [];
    const provider = make(async (url, init = {}) => { seen.push(init.signal); throw new Error("stop"); });
    await assert.rejects(provider.getPresence());
    if (provider.whoami) await assert.rejects(provider.whoami());
    assert.ok(seen.length > 0 && seen.every((signal) => signal instanceof AbortSignal), `${provider.id} sends a signal on every request`);
  }
});

test("Plex owner lookup has a deadline too, so a stuck /accounts can't hang presence", async () => {
  const seen = [];
  const provider = createPlexProvider({
    baseUrl: "http://plex.test", token: "t",
    fetchImpl: async (url, init = {}) => {
      seen.push([url, init.signal]);
      if (url.endsWith("/status/sessions")) return { ok: true, json: async () => ({ MediaContainer: { Metadata: [{ type: "track", title: "x", User: { id: "1" } }] } }) };
      return { ok: true };
    },
  });
  await provider.getPresence({ userId: "999" });
  assert.ok(seen.some(([url]) => url.endsWith("/accounts")));
  assert.ok(seen.every(([, signal]) => signal instanceof AbortSignal));
});

test("Jellyfin and Plex credentials never follow a cross-port redirect (#715)", async () => {
  const { createServer } = await import("node:http");
  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  const captured = [];
  const destination = createServer((request, response) => {
    captured.push(request.headers);
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  const destinationPort = await listen(destination);
  const source = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${destinationPort}/captured` });
    response.end();
  });
  const sourcePort = await listen(source);
  try {
    const baseUrl = `http://127.0.0.1:${sourcePort}`;
    await assert.rejects(createJellyfinProvider({ baseUrl, apiKey: "jf-secret" }).getPresence(), /outside its origin/);
    await assert.rejects(createPlexProvider({ baseUrl, token: "plex-secret" }).getPresence(), /outside its origin/);
    assert.deepEqual(captured, [], "the separate listener never sees either token");
  } finally {
    await Promise.all([source, destination].map((server) => new Promise((resolve) => server.close(resolve))));
  }
});

test("relative same-origin provider redirects keep credentials and a shared deadline (#715)", async () => {
  const seen = [];
  const redirected = await fetchWithTimeout(async (url, init) => {
    seen.push({ url, init });
    if (seen.length === 1) return { status: 302, headers: { get: (name) => name === "location" ? "/new-sessions" : null } };
    return { status: 200, ok: true };
  }, "https://media.example.test/Sessions", { headers: { "X-Emby-Token": "secret" } });
  assert.equal(redirected.ok, true);
  assert.deepEqual(seen.map(({ url }) => url), ["https://media.example.test/Sessions", "https://media.example.test/new-sessions"]);
  assert.ok(seen.every(({ init }) => init.redirect === "manual" && init.headers["X-Emby-Token"] === "secret" && init.signal === seen[0].init.signal));
});

test("provider redirects with embedded credentials and redirect loops are rejected (#715)", async () => {
  await assert.rejects(fetchWithTimeout(async () => ({ status: 302, headers: { get: () => "https://user:pass@media.example.test/new" } }), "https://media.example.test/Sessions"), /outside its origin/);
  let requests = 0;
  await assert.rejects(fetchWithTimeout(async () => { requests++; return { status: 302, headers: { get: () => "/loop" } }; }, "https://media.example.test/Sessions"), /redirected too many times/);
  assert.equal(requests, 4);
});
