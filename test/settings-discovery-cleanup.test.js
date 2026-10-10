import test from "node:test";
import assert from "node:assert/strict";
import { discoverSettingsServers } from "../src/settings-discovery.js";

async function scan(fetchImpl, failures = []) {
  return discoverSettingsServers({ hosts: ["192.168.1.2"], concurrency: 1, localDiscover: async () => [], timeoutMs: 10, onProbeFailure: failure => failures.push(failure), fetchImpl });
}

test("declared-overflow probes cancel bodies and abort transport", async () => {
  let cancelled = 0;
  const signals = [];
  const failures = [];
  await scan(async (_url, { signal }) => {
    signals.push(signal);
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-length": "65537" } });
  }, failures);
  assert.equal(cancelled, 4);
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(failures.map(f => f.reason), Array(4).fill("oversize"));
});

for (const behavior of ["stalls", "rejects", "throws"]) {
  test(`streamed overflow never waits for cleanup that ${behavior}`, async () => {
    let cancelled = 0, released = 0, reads = 0;
    const signals = [], failures = [];
    const work = scan(async (_url, { signal }) => {
      signals.push(signal);
      return { status: 200, headers: new Headers(), body: { getReader: () => ({
        read: async () => { reads++; return {done: false, value: new Uint8Array(65537)}; },
        cancel: () => { cancelled++; if (behavior === "throws") throw Error("cleanup"); if (behavior === "rejects") return Promise.reject(Error("cleanup")); return new Promise(() => {}); },
        releaseLock: () => { released++; },
      }) } };
    }, failures);
    let timer;
    const result = await Promise.race([work.then(() => "finished"), new Promise(resolve => { timer = setTimeout(() => resolve("hung"), 100); })]);
    clearTimeout(timer);
    assert.equal(result, "finished");
    assert.equal(reads, 4); assert.equal(cancelled, 4); assert.equal(released, 4);
    assert.ok(signals.every(signal => signal.aborted));
    assert.deepEqual(failures.map(f => f.reason), Array(4).fill("oversize"));
  });
}

test("probe read errors clean up and release reader locks", async () => {
  let cancelled = 0, released = 0;
  const signals = [], failures = [];
  await scan(async (_url, {signal}) => {
    signals.push(signal);
    return { status: 200, headers: new Headers(), body: {getReader: () => ({read: async () => {throw Error("read failed");}, cancel: () => {cancelled++; return Promise.reject(Error("cleanup"));}, releaseLock: () => {released++;}})} };
  }, failures);
  assert.equal(cancelled, 4); assert.equal(released, 4);
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(failures.map(f => f.reason), Array(4).fill("network_error"));
});

test("successful streamed probe releases its lock without cancellation", async () => {
  let cancelled = 0;
  const streams = [];
  const servers = await scan(async url => {
    if (!url.includes(":32400/")) throw Error("closed");
    const body = new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('<MediaContainer machineIdentifier="ok" version="1"/>'));c.close();},cancel(){cancelled++;}});
    streams.push(body);
    return new Response(body);
  });
  assert.equal(servers.length,1);
  assert.equal(cancelled,0);
  assert.ok(streams.every(body => !body.locked));
});

for (const path of ["overflow", "read_failure", "success"]) {
  test(`throwing lock release preserves the ${path} result`, async () => {
    const failures = [];
    let released = 0;
    const servers = await scan(async url => {
      if (!url.includes(":32400/")) throw Error("closed");
      let read = false;
      return { status: 200, headers: new Headers(), body: {getReader: () => ({
        read: async () => {
          if (path === "read_failure") throw Error("read failed");
          if (read) return {done:true};
          read = true;
          return {done:false,value:path === "overflow" ? new Uint8Array(65537) : new TextEncoder().encode('<MediaContainer machineIdentifier="ok" version="1"/>')};
        },
        cancel: () => Promise.resolve(),
        releaseLock: () => {released++; throw Error("lock cleanup failed");},
      })} };
    }, failures);
    assert.equal(released,1);
    assert.deepEqual(failures.filter(f=>f.provider === "plex").map(f=>f.reason), path === "success" ? [] : [path === "overflow" ? "oversize" : "network_error"]);
    assert.equal(servers.length,path === "success" ? 1 : 0);
  });
}
