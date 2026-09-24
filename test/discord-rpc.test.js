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

test("logs in again after the RPC client loses Discord", async () => {
  const made = [];
  const transport = createDiscordRpcTransport({ clientId: "123456789012345678", createClient: async () => {
    const rpc = { up: true, logins: 0, get connected() { return this.up; }, login: async () => { rpc.logins += 1; }, setActivity: async () => {}, clearActivity: async () => {}, destroy: async () => {} };
    made.push(rpc); return rpc;
  } });
  await transport.connect();
  assert.equal(transport.connected, true);
  made[0].up = false;
  assert.equal(transport.connected, false);
  await transport.connect();
  assert.equal(made.length, 2);
  assert.equal(made[1].logins, 1);
  assert.equal(transport.connected, true);
});

test("concurrent connects share one Discord login", async () => {
  const made = [];
  const transport = createDiscordRpcTransport({ clientId: "1552301957299839116", createClient: async () => {
    const client = { login: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }, setActivity: async () => {}, clearActivity: async () => {}, destroy: async () => {} };
    made.push(client);
    return client;
  } });
  await Promise.all([transport.connect(), transport.connect()]);
  assert.equal(made.length, 1);
  await transport.connect();
  assert.equal(made.length, 1);
});

test("a failed connect can be retried", async () => {
  let attempts = 0;
  const transport = createDiscordRpcTransport({ clientId: "1552301957299839116", createClient: async () => ({ login: async () => { attempts += 1; if (attempts === 1) throw new Error("Discord is not running"); }, setActivity: async () => {}, clearActivity: async () => {} }) });
  await assert.rejects(transport.connect(), /not running/);
  await transport.connect();
  assert.equal(transport.connected, true);
});
