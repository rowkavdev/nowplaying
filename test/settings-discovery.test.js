import test from "node:test";
import assert from "node:assert/strict";
import { discoverSettingsServers, subnetCandidates } from "../src/settings-discovery.js";
const reply = (text) => ({ status: 200, headers: { get: () => null }, text: async () => text });

test("caps private network candidates and excludes public and VPN interfaces", () => {
  const hosts = subnetCandidates(() => ({ a: [{ address: "192.168.7.42", family: "IPv4" }], b: [{ address: "10.4.2.18", family: 4 }], c: [{ address: "172.21.1.4", family: 4 }], d: [{ address: "100.64.1.2", family: 4 }], e: [{ address: "8.8.8.8", family: 4 }], tun0: [{ address: "10.8.0.42", family: 4 }], "WireGuard VPN": [{ address: "192.168.99.2", family: 4 }] }));
  assert.equal(hosts.length, 508);
  assert.deepEqual([hosts[0], hosts[253], hosts[254], hosts.at(-1)], ["192.168.7.1", "192.168.7.254", "10.4.2.1", "10.4.2.254"]);
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
  let receivedSignal;
  const servers = await discoverSettingsServers({ hosts: ["192.168.1.42"], signal: controller.signal, localDiscover: async ({ signal }) => { receivedSignal = signal; controller.abort(); return []; }, fetchImpl: async () => { throw new Error("LAN scan must not start"); } });
  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(servers, []);
});
