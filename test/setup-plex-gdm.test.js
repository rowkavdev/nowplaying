import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { parsePlexGdmReply, discoverPlexGdm } from "../src/setup-plex-gdm.js";
import { classifyPlex, discoverLocalServers } from "../src/setup-discovery.js";
import { discoverSettingsServers } from "../src/settings-discovery.js";

const gdm = (fields = {}) => Buffer.from(`HTTP/1.0 200 OK\r\nContent-Type: plex/media-server\r\nName: Living room Plex\r\nPort: 32400\r\nResource-Identifier: machine-1\r\nVersion: 1.41.0\r\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}\r\n`).join("")}\r\n`);
const reply = (text) => ({ status: 200, headers: { get: () => null }, text: async () => text });

test("GDM accepts server announcements from local sender only, never client or unsafe fields", () => {
  assert.deepEqual(parsePlexGdmReply(gdm(), "192.168.1.5"), { provider: "plex", baseUrl: "http://192.168.1.5:32400", version: "1.41.0", id: "machine-1", name: "Living room Plex" });
  assert.equal(parsePlexGdmReply(gdm(), "8.8.8.8"), null);
  assert.equal(parsePlexGdmReply(Buffer.from("HTTP/1.0 200 OK\r\nContent-Type: plex/media-player\r\nPort: 32400\r\nResource-Identifier: client\r\n"), "192.168.1.5"), null);
  assert.equal(parsePlexGdmReply(gdm({ Port: "oops" }), "192.168.1.5"), null);
  assert.equal(parsePlexGdmReply(Buffer.alloc(5000), "192.168.1.5"), null);
});

test("GDM sends both discovery probes to a fake responder, filters and dedupes replies", async () => {
  const responder = createSocket("udp4");
  await new Promise((resolve) => responder.bind(0, "127.0.0.1", resolve));
  const seen = [];
  responder.on("message", (message, peer) => {
    seen.push(message.toString("utf8"));
    responder.send(gdm(), peer.port, peer.address);
    responder.send(gdm(), peer.port, peer.address);
  });
  try {
    const endpoints = [{ address: "127.0.0.1", port: responder.address().port }, { address: "127.0.0.1", port: responder.address().port }];
    const found = await discoverPlexGdm({ timeoutMs: 80, endpoints });
    assert.equal(seen.length, 2);
    assert.ok(seen.every((message) => message.startsWith("M-SEARCH * HTTP/1.0")));
    assert.deepEqual(found.map((server) => [server.provider, server.name, server.version, server.baseUrl]), [["plex", "Living room Plex", "1.41.0", "http://127.0.0.1:32400"]]);
  } finally { responder.close(); }
});

test("HTTP identity finds localhost Plex without UDP; non-Plex host does not match", async () => {
  const fetchImpl = async (url) => {
    if (url === "http://127.0.0.1:32400/identity") return reply('<MediaContainer machineIdentifier="plex-local" version="1.41.1"/>');
    throw new Error("closed");
  };
  const found = await discoverSettingsServers({ fetchImpl, localDiscover: ({ fetchImpl: fetch }) => discoverLocalServers({ fetchImpl: fetch, networkHosts: [], discoverLan: async () => [], discoverPlex: async () => [] }) });
  assert.deepEqual(found, [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", version: "1.41.1", id: "plex-local", name: "Plex Media Server" }]);
  const empty = await discoverSettingsServers({ fetchImpl: async () => reply("not a Plex server"), localDiscover: async () => [], hosts: ["192.168.1.8"] });
  assert.deepEqual(empty, []);
});

test("a healthy Plex identity still works when UDP is blocked, and failures identify the probe", async () => {
  const failures = [];
  const found = await discoverSettingsServers({ fetchImpl: async (url) => {
    if (url.endsWith(":32400/identity")) return reply('<MediaContainer machineIdentifier="plex-local" version="1.43.3"/>');
    throw new Error("closed");
  }, localDiscover: ({ fetchImpl: fetch, onProbeFailure }) => discoverLocalServers({ fetchImpl: fetch, networkHosts: [], discoverLan: async () => [], discoverPlex: async () => { throw Error("UDP unavailable"); }, onProbeFailure }), onProbeFailure: (failure) => failures.push(failure) });
  assert.equal(found.find((server) => server.provider === "plex")?.id, "plex-local");
  assert.equal(failures.some((failure) => failure.provider === "plex"), false);
  assert.ok(failures.some((failure) => failure.provider === "navidrome" && failure.reason === "network_error"));
});

test("a real unauthenticated HTTP /identity responder is found without GDM", async () => {
  const http = createServer((req, res) => {
    assert.equal(req.url, "/identity");
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "content-type": "application/xml" });
    res.end('<MediaContainer size="0" machineIdentifier="real-local" version="1.41.2"/>');
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const found = await discoverLocalServers({ probes: [{ port: http.address().port, path: "/identity", classify: classifyPlex }], networkHosts: [], discoverLan: async () => [], discoverPlex: async () => [] });
    assert.deepEqual(found, [{ provider: "plex", baseUrl: `http://127.0.0.1:${http.address().port}`, version: "1.41.2", id: "real-local", name: "Plex Media Server" }]);
  } finally { http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); }
});

test("subnet HTTP identity discovers Plex alongside Navidrome and Jellyfin", async () => {
  const found = await discoverSettingsServers({ hosts: ["192.168.1.8"], localDiscover: async () => [], fetchImpl: async (url) => {
    if (url.endsWith(":32400/identity")) return reply('<MediaContainer machineIdentifier="plex-lan" version="1.41.1"/>');
    if (url.includes(":4533/")) return reply(JSON.stringify({ "subsonic-response": { type: "navidrome", serverVersion: "0.53.3" } }));
    if (url.includes(":8096/")) return reply(JSON.stringify({ Id: "jelly-1", ProductName: "Jellyfin Server", Version: "10.10.3" }));
    throw Error("closed");
  } });
  assert.deepEqual(found.map((server) => [server.provider, server.baseUrl, server.version]).sort(), [
    ["jellyfin", "http://192.168.1.8:8096", "10.10.3"],
    ["navidrome", "http://192.168.1.8:4533", "0.53.3"],
    ["plex", "http://192.168.1.8:32400", "1.41.1"],
  ]);
});
