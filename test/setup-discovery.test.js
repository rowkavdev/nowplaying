import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { classifyJellyfinOrEmby, classifyPlex, classifySubsonic, createSetupDiscoveryHandler, discoverLocalServers } from "../src/setup-discovery.js";

const reply = (status, text) => ({ status, headers: { get: () => null }, text: async () => text });

test("recognises each server from its public, unauthenticated response", () => {
  assert.deepEqual(classifySubsonic({ status: 200, text: JSON.stringify({ "subsonic-response": { status: "failed", type: "navidrome", serverVersion: "0.53.3" } }) }), { provider: "navidrome", version: "0.53.3" });
  assert.equal(classifySubsonic({ status: 200, text: JSON.stringify({ "subsonic-response": { type: "gonic" } }) }), null);
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "10.10.3", ProductName: "Jellyfin Server" }) }).provider, "jellyfin");
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "4.8.0" }) }).provider, "emby");
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "1", ProductName: "Other" }) }), null);
  assert.deepEqual(classifyPlex({ status: 200, text: '<MediaContainer size="0" machineIdentifier="abc" version="1.41.0"/>' }), { provider: "plex", version: "1.41.0" });
  assert.equal(classifyPlex({ status: 200, text: "<html>" }), null);
});

test("probes loopback only, without credentials or redirects, and skips failures", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes(":4533/")) return reply(200, JSON.stringify({ "subsonic-response": { type: "navidrome", serverVersion: "0.53<script>" } }));
    if (url.includes(":8096/")) throw new TypeError("fetch failed");
    return reply(200, "x".repeat(70 * 1024));
  };
  const servers = await discoverLocalServers({ fetchImpl });
  assert.deepEqual(servers, [{ provider: "navidrome", baseUrl: "http://127.0.0.1:4533", version: null }]);
  for (const { url, init } of seen) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.doesNotMatch(url, /token|apiKey|X-Plex|u=|p=/i);
    assert.equal(init.redirect, "error");
    assert.equal(Object.keys(init.headers).some((h) => /auth|token/i.test(h)), false);
  }
});

test("times out slow servers", async () => {
  const server = createServer(() => {}); // never answers
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const started = Date.now();
    const servers = await discoverLocalServers({ timeoutMs: 100, probes: [{ port, path: "/", classify: () => ({ provider: "plex" }) }] });
    assert.deepEqual(servers, []);
    assert.ok(Date.now() - started < 1500);
  } finally { server.closeAllConnections(); server.close(); }
});

test("serves discovery results with a short cache", async () => {
  let calls = 0; let clock = 0;
  const handle = createSetupDiscoveryHandler({ discover: async () => { calls += 1; return [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", version: null }]; }, now: () => clock });
  const first = await handle({ method: "GET", url: "/api/setup/discover" });
  assert.equal(JSON.parse(first.body).servers[0].provider, "plex");
  await handle({ method: "GET", url: "/api/setup/discover" });
  clock = 6000;
  await handle({ method: "GET", url: "/api/setup/discover" });
  assert.equal(calls, 2);
  assert.equal((await handle({ method: "POST", url: "/api/setup/discover" })).status, 405);
  assert.equal(await handle({ method: "GET", url: "/api/other" }), null);
});
