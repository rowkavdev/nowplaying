import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { discoverLanServers, parseDiscoveryReply } from "../src/setup-lan-discovery.js";

const buf = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value));

test("parses a Jellyfin discovery reply", () => {
  assert.deepEqual(parseDiscoveryReply(buf({ Address: "http://192.168.1.20:8096", Id: "f00d", Name: "Rowan PC", EndpointAddress: null }), "jellyfin"),
    { provider: "jellyfin", baseUrl: "http://192.168.1.20:8096", version: null, id: "f00d", name: "Rowan PC" });
  assert.equal(parseDiscoveryReply(buf({ Address: "http://host:8096/jellyfin/", Id: "a" }), "jellyfin").baseUrl, "http://host:8096/jellyfin");
});

test("rejects bad or unsafe replies", () => {
  for (const bad of [
    "not json", "", { Id: "a" }, { Address: "http://h:8096" },
    { Address: "file:///etc/passwd", Id: "a" }, { Address: "javascript:alert(1)", Id: "a" },
    { Address: "http://user:pw@h:8096", Id: "a" }, { Address: "http://h:8096/?t=1", Id: "a" },
    { Address: "http://h:8096", Id: "<script>" }, "x".repeat(5000),
  ]) assert.equal(parseDiscoveryReply(buf(bad), "jellyfin"), null, JSON.stringify(bad).slice(0, 40));
  assert.equal(parseDiscoveryReply(null, "emby"), null);
  assert.equal(parseDiscoveryReply(buf({ Address: "http://h:8096", Id: "a", Name: "<b>\u0007Den</b>" }), "emby").name, "bDen/b");
});

test("finds Jellyfin and Emby from a fake responder, tagged by which probe they answered", async () => {
  const responder = createSocket("udp4");
  await new Promise((resolve) => responder.bind(0, "127.0.0.1", resolve));
  const probes = [];
  responder.on("message", (msg, rinfo) => {
    const text = msg.toString();
    probes.push(text);
    if (/^who is jellyfinserver\?$/i.test(text)) {
      responder.send(buf({ Address: "http://127.0.0.1:8096", Id: "jf1", Name: "JF" }), rinfo.port, rinfo.address);
      responder.send(buf({ Address: "http://127.0.0.1:8096", Id: "jf1", Name: "JF" }), rinfo.port, rinfo.address); // duplicate
      responder.send(buf("garbage"), rinfo.port, rinfo.address);
    }
    if (/^who is embyserver\?$/i.test(text)) responder.send(buf({ Address: "http://127.0.0.1:8920", Id: "em1", Name: "Emby" }), rinfo.port, rinfo.address);
  });
  try {
    const servers = await discoverLanServers({ timeoutMs: 300, broadcastAddress: "127.0.0.1", port: responder.address().port });
    assert.deepEqual([...servers].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.provider, s.baseUrl]),
      [["emby", "http://127.0.0.1:8920"], ["jellyfin", "http://127.0.0.1:8096"]]);
    assert.deepEqual(probes.sort(), ["Who is JellyfinServer?", "who is EmbyServer?"]);
  } finally { responder.close(); }
});

test("returns nothing when no server answers, within the timeout", async () => {
  const started = Date.now();
  const servers = await discoverLanServers({ timeoutMs: 150, broadcastAddress: "127.0.0.1", port: 9 });
  assert.deepEqual(servers, []);
  assert.ok(Date.now() - started < 1500);
});

test("socket errors are swallowed", async () => {
  const servers = await discoverLanServers({ timeoutMs: 50, socketFactory: () => { throw new Error("EACCES"); } });
  assert.deepEqual(servers, []);
});
