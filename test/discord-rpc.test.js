import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordRpcTransport, toRpcActivity } from "../src/discord-rpc.js";

test("maps formatter fields onto Discord RPC names", () => {
  assert.deepEqual(toRpcActivity({type:"watching",details:"Film",state:"Paused",largeImage:"media",largeText:"Movie",smallImage:"pause",startTimestamp:1,endTimestamp:2}), {
    type:"watching",details:"Film",state:"Paused",largeImageKey:"media",largeImageText:"Movie",smallImageKey:"pause",startTimestamp:1,endTimestamp:2,
  });
});

test("logs in, publishes, clears and destroys an injected RPC client", async () => {
  const calls=[]; const rpc={login:async(v)=>calls.push(["login",v]),setActivity:async(v)=>calls.push(["set",v]),clearActivity:async()=>calls.push(["clear"]),destroy:async()=>calls.push(["destroy"])};
  const transport=createDiscordRpcTransport({clientId:"123456789012345678",createClient:async()=>rpc});
  await transport.connect(); await transport.connect(); await transport.setActivity({details:"Song"}); await transport.clearActivity(); await transport.close();
  assert.deepEqual(calls,[["login",{clientId:"123456789012345678"}],["set",{details:"Song"}],["clear"],["destroy"]]);
  await assert.rejects(()=>transport.setActivity({details:"offline"}),/not connected/);
});

test("does not retain an RPC client when login fails", async () => {
  let attempts=0; const transport=createDiscordRpcTransport({clientId:"123456789012345678",createClient:async()=>({login:async()=>{attempts+=1;throw new Error("Discord closed");},setActivity:async()=>{},clearActivity:async()=>{}})});
  await assert.rejects(()=>transport.connect(),/Discord closed/); await assert.rejects(()=>transport.connect(),/Discord closed/); assert.equal(attempts,2);
});

test("validates the application ID and client contract", async () => {
  assert.throws(()=>createDiscordRpcTransport({clientId:"secret",createClient:()=>({})}),/application ID/);
  const transport=createDiscordRpcTransport({clientId:"123456789012345678",createClient:async()=>({})});
  await assert.rejects(()=>transport.connect(),/expected login/);
});
