
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
  const client=createDiscordClient({transport:t,retryDelayMs:500,minUpdateIntervalMs:0,now:()=>time});
  assert.equal(await client.publish({}),false); assert.equal(await client.publish({}),false); assert.equal(attempts,1);
  time=1500; assert.equal(await client.publish({}),true); assert.equal(attempts,2);
});

test("disconnects and backs off when publishing fails", async () => {
  let time=0; const t=transport({setActivity:async()=>{throw new Error("socket closed");}});
  const client=createDiscordClient({transport:t,retryDelayMs:100,minUpdateIntervalMs:0,now:()=>time});
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
