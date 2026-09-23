import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { classifyJellyfinOrEmby, classifyPlex, classifySubsonic, createSetupDiscoveryHandler, discoverLocalServers, gatewayCandidates, mergeServers } from "../src/setup-discovery.js";

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

test("probes the gateway for Navidrome and Jellyfin/Emby, but not Plex", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.startsWith("http://192.168.1.1:4533/")) return reply(200, JSON.stringify({ "subsonic-response": { type: "navidrome", serverVersion: "0.53.3" } }));
    throw new TypeError("fetch failed");
  };
  const servers = await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: ["192.168.1.1"] });
  assert.deepEqual(servers, [{ provider: "navidrome", baseUrl: "http://192.168.1.1:4533", version: "0.53.3" }]);
  assert.deepEqual(seen.filter((u) => u.includes("192.168.1.1")).map((u) => new URL(u).port).sort(), ["4533", "8096"]);
  assert.equal(seen.length, 5);
});

test("keeps at most N probes in flight", async () => {
  let active = 0; let peak = 0;
  const fetchImpl = async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active -= 1; throw new TypeError("x"); };
  await discoverLocalServers({ fetchImpl, discoverLan: async () => [], networkHosts: ["10.0.0.1", "10.0.1.1", "10.0.2.1"], concurrency: 2 });
  assert.equal(peak, 2);
});
