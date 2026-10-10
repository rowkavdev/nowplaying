import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { classifyJellyfinOrEmby, classifyPlex, classifySubsonic, createSetupDiscoveryHandler, discoverLocalServers, gatewayCandidates, mergeServers } from "../src/setup-discovery.js";

// Models a real server's bounded JSON/XML reply: a declared Content-Length and
// no streaming body, so the fallback adapter path sees a trusted size.
const reply = (status, text) => ({ status, headers: { get: (name) => name === "content-length" ? String(Buffer.byteLength(text)) : null }, text: async () => text });

test("recognises each server from its public, unauthenticated response", () => {
  assert.deepEqual(classifySubsonic({ status: 200, text: JSON.stringify({ "subsonic-response": { status: "failed", type: "navidrome", serverVersion: "0.53.3" } }) }), { provider: "navidrome", version: "0.53.3" });
  assert.equal(classifySubsonic({ status: 200, text: JSON.stringify({ "subsonic-response": { type: "gonic" } }) }), null);
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "10.10.3", ProductName: "Jellyfin Server" }) }).provider, "jellyfin");
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "4.8.0" }) }).provider, "emby");
  assert.equal(classifyJellyfinOrEmby({ status: 200, text: JSON.stringify({ Id: "a", Version: "1", ProductName: "Other" }) }), null);
  assert.deepEqual(classifyPlex({ status: 200, text: '<MediaContainer size="0" machineIdentifier="abc" version="1.41.0"/>' }), { provider: "plex", version: "1.41.0", id: "abc", name: "Plex Media Server" });
  assert.equal(classifyPlex({ status: 200, text: "<html>" }), null);
});

test("recognises Plex's JSON identity and rejects invalid identities", () => {
  const identity = { MediaContainer: { size: 0, claimed: true, machineIdentifier: "abc123", version: "1.43.4.10903-e5521bd8c" } };
  assert.deepEqual(classifyPlex({ status: 200, text: JSON.stringify(identity) }), { provider: "plex", id: "abc123", version: "1.43.4.10903-e5521bd8c", name: "Plex Media Server" });
  for (const text of ["{invalid", "null", "[]", '{"MediaContainer":[]}', '{"MediaContainer":{"machineIdentifier":123}}', '{"MediaContainer":{"machineIdentifier":""}}', '{"machineIdentifier":"abc123"}', '<MediaContainer/><Other machineIdentifier="abc123"/>']) {
    assert.equal(classifyPlex({ status: 200, text }), null, text);
  }
  for (const status of [401, 403, 500]) assert.equal(classifyPlex({ status, text: JSON.stringify(identity) }), null);
});

test("discovers Plex when its identity endpoint honors the JSON Accept preference", async () => {
  const servers = await discoverLocalServers({
    fetchImpl: async (url, init) => {
      if (!url.endsWith(":32400/identity")) throw new TypeError("not available");
      assert.match(init.headers.Accept, /^application\/json/);
      return reply(200, JSON.stringify({ MediaContainer: { machineIdentifier: "example-server", version: "1.43.4" } }));
    },
    discoverLan: async () => [], discoverPlex: async () => [], networkHosts: [],
  });
  assert.deepEqual(servers, [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", id: "example-server", version: "1.43.4", name: "Plex Media Server" }]);
});

test("probes loopback only, without credentials or redirects, and skips failures", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes(":4533/")) return reply(200, JSON.stringify({ "subsonic-response": { type: "navidrome", serverVersion: "0.53<script>" } }));
    if (url.includes(":8096/")) throw new TypeError("fetch failed");
    return reply(200, "x".repeat(70 * 1024));
  };
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: [] });
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
    const servers = await discoverLocalServers({ timeoutMs: 100, discoverLan: async () => [], networkHosts: [], probes: [{ port, path: "/", classify: () => ({ provider: "plex" }) }] });
    assert.deepEqual(servers, []);
    assert.ok(Date.now() - started < 1500);
  } finally { server.closeAllConnections(); server.close(); }
});

test("serves discovery results with a short cache", async () => {
  let calls = 0; let clock = 0;
  const handle = createSetupDiscoveryHandler({ discover: async () => { calls += 1; return [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", version: null }]; }, elapsedNow: () => clock });
  const first = await handle({ method: "GET", url: "/api/setup/discover" });
  assert.equal(JSON.parse(first.body).servers[0].provider, "plex");
  await handle({ method: "GET", url: "/api/setup/discover" });
  clock = 6000;
  await handle({ method: "GET", url: "/api/setup/discover" });
  assert.equal(calls, 2);
  assert.equal((await handle({ method: "POST", url: "/api/setup/discover" })).status, 405);
  assert.equal(await handle({ method: "GET", url: "/api/other" }), null);
});

test("adds LAN servers and drops ones already found on this PC", async () => {
  const fetchImpl = async (url) => {
    if (url.includes(":8096/")) return reply(200, JSON.stringify({ Id: "abc123", Version: "10.10.3", ProductName: "Jellyfin Server" }));
    throw new TypeError("fetch failed");
  };
  const lan = [
    { provider: "jellyfin", baseUrl: "http://192.168.1.20:8096", version: null, id: "abc123", name: "PC" },
    { provider: "emby", baseUrl: "http://192.168.1.30:8096", version: null, id: "emby1", name: "Den" },
  ];
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => lan, networkHosts: [] });
  assert.deepEqual(servers.map((s) => [s.provider, s.baseUrl]), [["jellyfin", "http://127.0.0.1:8096"], ["emby", "http://192.168.1.30:8096"]]);
});

test("a failing LAN scan does not break loopback discovery", async () => {
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  assert.deepEqual(await discoverLocalServers({ fetchImpl, discoverLan: async () => { throw new Error("EACCES"); }, networkHosts: [] }), []);
});

test("mergeServers dedupes by url when ids are missing", () => {
  const merged = mergeServers([{ provider: "plex", baseUrl: "http://127.0.0.1:32400" }], [{ provider: "plex", baseUrl: "http://127.0.0.1:32400" }, { provider: "jellyfin", baseUrl: "http://10.0.0.2:8096" }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(mergeServers([], null), []);
});

test("guesses gateways from private IPv4 interfaces only", () => {
  const nics = () => ({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [{ address: "192.168.1.42", family: "IPv4", internal: false }, { address: "fe80::1", family: "IPv6", internal: false }],
    wifi: [{ address: "10.0.5.9", family: 4, internal: false }],
    vpn: [{ address: "100.101.102.103", family: "IPv4", internal: false }], // tailscale CGNAT, not a LAN
    pub: [{ address: "8.8.8.8", family: "IPv4", internal: false }],
    self: [{ address: "172.20.0.1", family: "IPv4", internal: false }], // this PC is the .1
  });
  assert.deepEqual(gatewayCandidates(nics), ["192.168.1.1", "10.0.5.1"]);
  assert.deepEqual(gatewayCandidates(() => { throw new Error("nope"); }), []);
});

test("probes gateway Navidrome, Jellyfin/Emby, and Plex identity", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.startsWith("http://192.168.1.1:4533/")) return reply(200, JSON.stringify({ "subsonic-response": { type: "navidrome", serverVersion: "0.53.3" } }));
    throw new TypeError("fetch failed");
  };
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: ["192.168.1.1"] });
  assert.deepEqual(servers, [{ provider: "navidrome", baseUrl: "http://192.168.1.1:4533", version: "0.53.3" }]);
  assert.deepEqual(seen.filter((u) => u.includes("192.168.1.1")).map((u) => new URL(u).port).sort(), ["32400", "4533", "8096"]);
  assert.equal(seen.length, 6);
});

test("keeps at most N probes in flight", async () => {
  let active = 0; let peak = 0;
  const fetchImpl = async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active -= 1; throw new TypeError("x"); };
  await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: ["10.0.0.1", "10.0.1.1", "10.0.2.1"], concurrency: 2 });
  assert.equal(peak, 2);
});

test("probe stops reading at the byte cap instead of buffering the whole body (#745)", async () => {
  let chunksRead = 0, cancelled = false;
  const chunk = new Uint8Array(64 * 1024);
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => null }, // no Content-Length
    body: {
      getReader: () => ({
        read: async () => { chunksRead += 1; return chunksRead > 16 ? { done: true } : { done: false, value: chunk }; },
        cancel: async () => { cancelled = true; },
      }),
    },
    text: async () => { throw new Error("text() must not be used for a streaming body"); },
  });
  const failures = [];
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: [], probes: [{ port: 32400, path: "/", classify: () => ({ provider: "plex" }) }], onProbeFailure: (f) => failures.push(f) });
  assert.deepEqual(servers, []);
  assert.equal(failures[0]?.reason, "oversize");
  assert.equal(cancelled, true);
  assert.ok(chunksRead <= 3, `stream should stop at the cap, read ${chunksRead} chunks`);
});

test("non-streaming fallback refuses to buffer a body with no declared size (#747)", async () => {
  let textCalled = false;
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => null }, // no Content-Length, no streaming body
    text: async () => { textCalled = true; return "x".repeat(1024 * 1024); },
  });
  const failures = [];
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: [], probes: [{ port: 32400, path: "/", classify: () => ({ provider: "plex" }) }], onProbeFailure: (f) => failures.push(f) });
  assert.deepEqual(servers, []);
  assert.equal(failures[0]?.reason, "oversize");
  assert.equal(textCalled, false, "text() must not be called without a trusted size");
});

test("discovery cache expires after five elapsed seconds (#753)", async () => {
  let elapsed = 1_800_000;
  let calls = 0;
  let name = "stale-server";
  const handle = createSetupDiscoveryHandler({ discover: async () => { calls += 1; return [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", name }]; }, cacheMs: 5000, elapsedNow: () => elapsed });
  const get = () => handle({ method: "GET", url: "/api/setup/discover" }).then((r) => JSON.parse(r.body).servers[0].name);
  assert.equal(await get(), "stale-server");
  name = "fresh-server";
  // The cache reads only elapsed time, so this is the rollback case from the
  // issue: six elapsed seconds later the five-second cache has expired and
  // discovery runs again.
  elapsed += 6000;
  assert.equal(await get(), "fresh-server");
  assert.equal(calls, 2);
});
