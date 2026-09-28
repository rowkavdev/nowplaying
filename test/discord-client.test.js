
import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordClient } from "../src/discord-client.js";

function transport(overrides = {}) {
  const calls = [];
  return { calls, connect: async () => calls.push("connect"), setActivity: async (a) => calls.push(["set",a]), clearActivity: async () => calls.push("clear"), close: async () => calls.push("close"), ...overrides };
}

test("connects lazily, publishes, clears and closes", async () => {
  const t=transport(); const client=createDiscordClient({transport:t,minUpdateIntervalMs:0});
  assert.equal(await client.publish({details:"Film"}),true); assert.equal(client.connected,true);
  assert.equal(await client.publish(null),true); await client.close();
  assert.deepEqual(t.calls,["connect",["set",{details:"Film"}],"clear","close"]);
  assert.equal(await client.publish({details:"ignored"}),false);
});

test("backs off after connection failure and retries later", async () => {
  let time=1000, attempts=0; const t=transport({connect:async()=>{attempts+=1;if(attempts===1)throw new Error("offline");}});
  const client=createDiscordClient({transport:t,retryDelayMs:500,minUpdateIntervalMs:0,random:()=>0,now:()=>time});
  assert.equal(await client.publish({}),false); assert.equal(await client.publish({}),false); assert.equal(attempts,1);
  time=1500; assert.equal(await client.publish({}),true); assert.equal(attempts,2);
});

test("disconnects and backs off when publishing fails", async () => {
  let time=0; const t=transport({setActivity:async()=>{throw new Error("socket closed");}});
  const client=createDiscordClient({transport:t,retryDelayMs:100,minUpdateIntervalMs:0,random:()=>0,now:()=>time});
  assert.equal(await client.publish({}),false); assert.equal(client.connected,false);
  time=99; assert.equal(await client.publish({}),false); time=100; assert.equal(await client.publish(null),true);
});


test("deduplicates identical activities and throttles changed updates", async () => {
  let time=0; const t=transport(); const client=createDiscordClient({transport:t,minUpdateIntervalMs:5000,now:()=>time});
  assert.equal(await client.publish({details:"One",state:"Playing"}),true);
  assert.equal(await client.publish({state:"Playing",details:"One"}),true);
  assert.equal(await client.publish({details:"Two"}),false);
  time=5000; assert.equal(await client.publish({details:"Two"}),true);
  assert.deepEqual(t.calls,["connect",["set",{details:"One",state:"Playing"}],["set",{details:"Two"}]]);
});

test("republishes an unchanged activity when the transport reports it lost Discord", async () => {
  let up = true; const t = transport(); Object.defineProperty(t, "connected", { get: () => up });
  const client = createDiscordClient({ transport: t, minUpdateIntervalMs: 0 });
  assert.equal(await client.publish({ details: "Film" }), true);
  assert.equal(await client.publish({ details: "Film" }), true);
  up = false;
  assert.equal(await client.publish({ details: "Film" }), true);
  assert.deepEqual(t.calls, ["connect", ["set", { details: "Film" }], "connect", ["set", { details: "Film" }]]);
});

test("backs off exponentially up to the cap and resets once Discord answers", async () => {
  let time = 0, up = false; const t = transport({ connect: async () => { if (!up) throw new Error("offline at C:\\Users\\rowan"); } });
  const client = createDiscordClient({ transport: t, retryDelayMs: 100, maxRetryDelayMs: 400, minUpdateIntervalMs: 0, random: () => 0, now: () => time });
  assert.deepEqual(client.status(), { state: "disconnected", lastPublishedAt: null, lastError: null, nextRetryInMs: 0 });
  await client.publish({}); assert.equal(client.status().nextRetryInMs, 100);
  time = 100; await client.publish({}); assert.equal(client.status().nextRetryInMs, 200);
  time = 300; await client.publish({}); assert.equal(client.status().nextRetryInMs, 400);
  time = 700; await client.publish({}); assert.equal(client.status().nextRetryInMs, 400);
  const degraded = client.status();
  assert.equal(degraded.state, "degraded"); assert.equal(degraded.lastError, "DISCORD_NOT_RUNNING");
  assert.doesNotMatch(JSON.stringify(degraded), /rowan|offline/);
  up = true; time = 1100; assert.equal(await client.publish({ details: "Film" }), true);
  assert.deepEqual(client.status(), { state: "ready", lastPublishedAt: new Date(1100).toISOString(), lastError: null, nextRetryInMs: 0 });
  await client.close(); assert.equal(client.status().state, "closed");
});

test("failed publish invalidates dedupe so an unchanged prior activity reconnects", async () => {
  let time = 0, fail = false;
  const t = transport({ setActivity: async (activity) => {
    t.calls.push(["set", activity]);
    if (fail) throw new Error("Discord RPC failed");
  } });
  const client = createDiscordClient({ transport: t, retryDelayMs: 100, minUpdateIntervalMs: 0,
    jitter: 0, now: () => time });
  const first = { details: "A" };
  assert.equal(await client.publish(first), true);
  fail = true;
  assert.equal(await client.publish({ details: "B" }), false);
  assert.equal(client.status().state, "degraded");
  assert.equal(await client.publish(first), false, "backoff still applies to the old key");
  time = 100;
  fail = false;
  assert.equal(await client.publish(first), true);
  assert.deepEqual(t.calls, ["connect", ["set", first], ["set", { details: "B" }], "connect", ["set", first]]);
  assert.equal(client.status().state, "ready");
});

test("rejects a retry cap below the first delay", () => {
  assert.throws(() => createDiscordClient({ transport: transport(), retryDelayMs: 1000, maxRetryDelayMs: 500 }), RangeError);
});

test("reconnect delays are jittered down, never above the cap", async () => {
  let time = 0;
  const offline = () => transport({ connect: async () => { throw new Error("offline"); } });
  const delays = [];
  for (const share of [0, 0.5, 1]) {
    const client = createDiscordClient({ transport: offline(), retryDelayMs: 1000, maxRetryDelayMs: 1000, minUpdateIntervalMs: 0, random: () => share, now: () => time });
    await client.publish({});
    delays.push(client.status().nextRetryInMs);
  }
  assert.deepEqual(delays, [1000, 900, 800]);
  const odd = createDiscordClient({ transport: offline(), retryDelayMs: 1000, minUpdateIntervalMs: 0, random: () => 7, now: () => time });
  await odd.publish({});
  assert.equal(odd.status().nextRetryInMs, 800);
});

test("rejects bad jitter settings", () => {
  assert.throws(() => createDiscordClient({ transport: transport(), jitter: 0.9 }), RangeError);
  assert.throws(() => createDiscordClient({ transport: transport(), jitter: -0.1 }), RangeError);
  assert.throws(() => createDiscordClient({ transport: transport(), random: 1 }), TypeError);
});

test("a throttled clear retries at the limiter boundary and does not leave old activity (#713)", async () => {
  let time = 0;
  const queued = [];
  const t = transport();
  const client = createDiscordClient({ transport: t, minUpdateIntervalMs: 15_000, now: () => time,
    setTimer: (run, ms) => { const task = { run, ms }; queued.push(task); return task; },
    clearTimer: (task) => { const index = queued.indexOf(task); if (index >= 0) queued.splice(index, 1); } });
  assert.equal(await client.publish({ details: "Secret song" }), true);
  time = 1_000;
  assert.equal(await client.publish(null), false);
  assert.deepEqual(t.calls, ["connect", ["set", { details: "Secret song" }]]);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].ms, 14_000);
  time = 15_000;
  await queued.shift().run();
  assert.deepEqual(t.calls, ["connect", ["set", { details: "Secret song" }], "clear"]);
  assert.equal(queued.length, 0);
});

test("a newer activity cancels a queued clear, and close cancels it too (#713)", async () => {
  let time = 0;
  const queued = [];
  const t = transport();
  const client = createDiscordClient({ transport: t, minUpdateIntervalMs: 15_000, now: () => time,
    setTimer: (run, ms) => { const task = { run, ms }; queued.push(task); return task; },
    clearTimer: (task) => { const index = queued.indexOf(task); if (index >= 0) queued.splice(index, 1); } });
  await client.publish({ details: "Old" });
  time = 1_000;
  await client.publish(null);
  assert.equal(queued.length, 1);
  await client.publish({ details: "New" });
  assert.equal(queued.length, 0);
  time = 15_000;
  await client.publish({ details: "New" });
  await client.publish(null);
  assert.equal(queued.length, 1);
  await client.close();
  assert.equal(queued.length, 0);
  assert.equal(t.calls.includes("clear"), false);
});

test("a queued clear retries after a transport failure without reporting success (#713)", async () => {
  let time = 0, failClear = true;
  const queued = [];
  const t = transport({ clearActivity: async () => {
    t.calls.push("clear");
    if (failClear) throw new Error("offline");
  } });
  const client = createDiscordClient({ transport: t, minUpdateIntervalMs: 15_000, retryDelayMs: 100,
    jitter: 0, now: () => time, setTimer: (run, ms) => { const task = { run, ms }; queued.push(task); return task; },
    clearTimer: (task) => { const index = queued.indexOf(task); if (index >= 0) queued.splice(index, 1); } });
  await client.publish({ details: "Secret" });
  time = 1_000;
  assert.equal(await client.publish(null), false);
  time = 15_000;
  await queued.shift().run();
  assert.equal(client.status().state, "degraded");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].ms, 100);
  time = 15_100;
  failClear = false;
  await queued.shift().run();
  assert.equal(client.status().state, "ready");
  assert.deepEqual(t.calls, ["connect", ["set", { details: "Secret" }], "clear", "connect", "clear"]);
  assert.equal(queued.length, 0);
});
