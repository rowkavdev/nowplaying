import test from "node:test";
import assert from "node:assert/strict";
import { discoverSettingsServers, subnetCandidates } from "../src/settings-discovery.js";
const reply = (text) => ({ status: 200, headers: { get: () => null }, text: async () => text });

test("does not enumerate interfaces; scans only an explicitly selected private /24", () => {
  assert.deepEqual(subnetCandidates(), []);
  assert.deepEqual(subnetCandidates(""), []);
  const hosts = subnetCandidates("192.168.7.0/24");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "192.168.7.1");
  assert.equal(hosts.at(-1), "192.168.7.254");
  assert.throws(() => subnetCandidates("8.8.8.0/24"), /private/);
  assert.throws(() => subnetCandidates("10.1.0.0/16"), /private IPv4 subnet/);
  assert.throws(() => subnetCandidates("10.8.0.42"), /private IPv4 subnet/);
});
test("probes known ports without credentials or redirect, finds a server and ignores public hosts", async () => {
  const calls = [];
  const servers = await discoverSettingsServers({ hosts: ["192.168.1.4", "8.8.8.8"], localDiscover: async () => [], fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes(":32400/")) return reply('<MediaContainer machineIdentifier="test" version="1.0"/>');
    throw new Error("closed");
  } });
  assert.deepEqual(servers.map((s) => [s.provider, s.baseUrl]), [["plex", "http://192.168.1.4:32400"]]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(({ url, opts }) => !url.includes("8.8.8.8") && opts.redirect === "error" && !Object.keys(opts.headers).some((key) => /auth|token/i.test(key))));
});
test("aborted scan schedules no further probes", async () => {
  const controller = new AbortController();
  let count = 0;
  const servers = await discoverSettingsServers({ hosts: ["10.0.0.1", "10.0.0.2"], concurrency: 1, localDiscover: async () => [], signal: controller.signal, fetchImpl: async () => { count++; controller.abort(); throw new Error("abort"); } });
  assert.deepEqual(servers, []);
  assert.equal(count, 1);
});

test("cancels local gateway and UDP discovery before LAN probes", async () => {
  const controller = new AbortController();
  let receivedSignal; let receivedHosts;
  const servers = await discoverSettingsServers({ hosts: ["192.168.1.42"], signal: controller.signal, localDiscover: async ({ signal, networkHosts }) => { receivedSignal = signal; receivedHosts = networkHosts; controller.abort(); return []; }, fetchImpl: async () => { throw new Error("LAN scan must not start"); } });
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(receivedHosts, []);
  assert.deepEqual(servers, []);
});
