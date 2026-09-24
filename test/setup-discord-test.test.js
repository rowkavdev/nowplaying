import test from "node:test";
import assert from "node:assert/strict";
import { createSetupDiscordTestHandler } from "../src/setup-discord-test.js";

const CLIENT_ID = "123456789012345678";
const post = (handle) => handle({ method: "POST", url: "/api/setup/discord-test" }).then((r) => [r.status, JSON.parse(r.body)]);

function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    client: {
      login: async (args) => { calls.push(["login", args]); if (overrides.login) throw overrides.login; },
      setActivity: async (activity) => { calls.push(["set", activity]); if (overrides.set) throw overrides.set; },
      clearActivity: async () => { calls.push(["clear"]); },
      destroy: async () => { calls.push(["destroy"]); },
    },
  };
}

test("Test Discord shows a fixed test status, clears it and closes the connection (#141)", async () => {
  const { client, calls } = fakeClient();
  const waited = [];
  const handle = createSetupDiscordTestHandler({ clientId: CLIENT_ID, createClient: () => client, showMs: 5000, sleep: async (ms) => { waited.push(ms); } });
  assert.deepEqual(await post(handle), [200, { ok: true, status: "connected" }]);
  assert.deepEqual(calls.map((c) => c[0]), ["login", "set", "clear", "destroy"]);
  assert.deepEqual(calls[0][1], { clientId: CLIENT_ID });
  assert.deepEqual(calls[1][1], { type: "listening", details: "Testing NowPlaying setup", state: "This goes away in a few seconds" });
  assert.deepEqual(waited, [5000]);
});

test("Test Discord says when Discord isn't open, doesn't answer, or refuses", async () => {
  const run = async (overrides) => {
    const { client, calls } = fakeClient(overrides);
    const [, body] = await post(createSetupDiscordTestHandler({ clientId: CLIENT_ID, createClient: () => client, sleep: async () => {} }));
    assert.equal(calls.at(-1)[0], "destroy");
    return body.status;
  };
  assert.equal(await run({ login: new Error("Discord is not running") }), "not_running");
  assert.equal(await run({ login: new Error("Discord handshake timed out") }), "no_answer");
  assert.equal(await run({ login: new Error("Discord closed the connection: Invalid Client ID") }), "rejected");
  assert.equal(await run({ set: new Error("Discord rejected SET_ACTIVITY: nope") }), "rejected");
});

test("without a Discord app ID the test says so and connects to nothing", async () => {
  let created = false;
  const handle = createSetupDiscordTestHandler({ clientId: null, createClient: () => { created = true; } });
  assert.deepEqual(await post(handle), [200, { ok: false, status: "no_app_id" }]);
  assert.equal(created, false);
});

test("one test at a time, POST only", async () => {
  let release;
  const { client } = fakeClient();
  const handle = createSetupDiscordTestHandler({ clientId: CLIENT_ID, createClient: () => client, sleep: () => new Promise((resolve) => { release = resolve; }) });
  const first = post(handle);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await post(handle), [429, { ok: false, status: "test_running" }]);
  release();
  assert.equal((await first)[1].status, "connected");
  assert.equal((await handle({ method: "GET", url: "/api/setup/discord-test" })).status, 405);
  assert.equal(await handle({ method: "POST", url: "/api/setup/other" }), null);
});
