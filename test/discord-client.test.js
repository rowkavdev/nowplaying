
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
