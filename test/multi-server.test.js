import test from "node:test";
import assert from "node:assert/strict";
import { createMultiServerProvider } from "../src/multi-server.js";

const server = (provider, displayName = "Rowan") => ({ provider, identity: { id: "x", displayName } });

test("polls every server together; a playing server wins over an idle first server (#252)", async () => {
  let calls = 0;
  const playing = { state: "playing", kind: "track", title: "Song" };
  const multi = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => { calls += 1; return { state: "idle" }; } } },
    { server: server("plex"), provider: { getPresence: async () => { calls += 1; return playing; } } },
  ], { now: () => 42 });
  assert.deepEqual(multi.servers().map((s) => s.state), ["waiting", "waiting"]);
  const [a, b] = await Promise.all([multi.getPresence(), multi.getPresence()]);
  assert.deepEqual([a, b], [playing, playing]);
  assert.equal(calls, 2, "callers at the same moment share one round");
  assert.deepEqual(multi.servers(), [
    { provider: "jellyfin", displayName: "Rowan", state: "idle", checkedAt: 42 },
    { provider: "plex", displayName: "Rowan", state: "playing", checkedAt: 42 },
  ]);
});

test("a failing first server fails like before; a failing other server only shows on its own row (#252)", async () => {
  const down = Object.assign(new Error("secret http://10.0.0.2 detail"), { code: "ECONNREFUSED" });
  const first = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => { throw down; } } },
    { server: server("emby"), provider: { getPresence: async () => ({ state: "idle" }) } },
  ]);
  await assert.rejects(first.getPresence(), (error) => error === down);
  assert.deepEqual(first.servers().map((s) => [s.state, s.reason]), [["error", "unreachable"], ["idle", undefined]]);
  assert.doesNotMatch(JSON.stringify(first.servers()), /10\.0\.0\.2|secret/);
  const other = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => ({ state: "idle" }) } },
    { server: server("emby"), provider: { getPresence: async () => { throw down; } } },
    { server: server("plex"), unavailable: "CREDENTIAL_MISSING" },
  ]);
  assert.deepEqual(await other.getPresence(), { state: "idle" });
  assert.deepEqual(other.servers().map((s) => [s.provider, s.state, s.reason]), [["jellyfin", "idle", undefined], ["emby", "error", "unreachable"], ["plex", "unavailable", "CREDENTIAL_MISSING"]]);
});

test("most recent request wins: the server that started or resumed last shows (#252)", async () => {
  let clock = 0;
  const state = { jellyfin: { state: "idle" }, plex: { state: "idle" } };
  const multi = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => state.jellyfin } },
    { server: server("plex"), provider: { getPresence: async () => state.plex } },
  ], { now: () => clock });
  const tick = async () => { clock += 1; return multi.getPresence(); };
  assert.deepEqual(await tick(), { state: "idle" }, "nothing playing shows the first server");
  state.plex = { state: "playing", kind: "track", title: "A" };
  assert.equal((await tick()).title, "A");
  state.jellyfin = { state: "playing", kind: "movie", title: "B" };
  assert.equal((await tick()).title, "B", "newer playback wins");
  assert.equal((await tick()).title, "B", "still playing does not reset who is newer");
  state.plex = { state: "playing", kind: "track", title: "C" };
  assert.equal((await tick()).title, "C", "a new item counts as a new request");
  state.plex = { state: "paused", kind: "track", title: "C" };
  assert.equal((await tick()).title, "B", "playing beats paused");
  state.plex = { state: "playing", kind: "track", title: "C" };
  assert.equal((await tick()).title, "C", "resuming counts as a new request");
  state.plex = { state: "idle" };
  state.jellyfin = { state: "paused", kind: "movie", title: "B" };
  assert.equal((await tick()).title, "B", "a paused server shows over idle ones");
});

test("a playing server still shows when the first server is down (#252)", async () => {
  const multi = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => { throw new Error("down"); } } },
    { server: server("plex"), provider: { getPresence: async () => ({ state: "playing", kind: "track", title: "A" }) } },
  ]);
  assert.equal((await multi.getPresence()).title, "A");
});

test("needs at least one server with a provider (#252)", () => {
  assert.throws(() => createMultiServerProvider([]), /at least one server/);
  assert.throws(() => createMultiServerProvider([{ server: server("plex") }]), /needs a provider/);
  assert.throws(() => createMultiServerProvider([{ provider: { getPresence: async () => ({}) } }]), /needs its server/);
});

test("first server unavailable and nothing playing: the next server's result shows, never undefined", async () => {
  const idle = createMultiServerProvider([
    { server: { provider: "plex" }, unavailable: "CONFIG_INVALID" },
    { server: { provider: "jellyfin" }, provider: { getPresence: async () => ({ state: "idle" }) } },
  ]);
  assert.deepEqual(await idle.getPresence(), { state: "idle" });
  const failing = createMultiServerProvider([
    { server: { provider: "plex" }, unavailable: "CONFIG_INVALID" },
    { server: { provider: "jellyfin" }, provider: { getPresence: async () => { throw new Error("down"); } } },
  ]);
  await assert.rejects(failing.getPresence(), /down/);
  const none = createMultiServerProvider([{ server: { provider: "plex" }, unavailable: "CONFIG_INVALID" }]);
  await assert.rejects(none.getPresence(), /No media server is available/);
});


test("revoked sign-in on one server keeps healthy playback but records its safe failure", async () => {
  const secret = "private-token-123";
  const rejected = Object.assign(new Error(`token ${secret} rejected`), { status: 401 });
  const multi = createMultiServerProvider([
    { server: server("plex"), provider: { getPresence: async () => { throw rejected; } } },
    { server: server("jellyfin"), provider: { getPresence: async () => ({ state: "playing", kind: "track", title: "Song" }) } },
  ]);
  assert.equal((await multi.getPresence()).title, "Song");
  assert.deepEqual(multi.servers().map(({ state, reason }) => [state, reason]), [["error", "unauthorized"], ["playing", undefined]]);
  assert.doesNotMatch(JSON.stringify(multi.servers()), /private-token|rejected/);
});

test("5xx and network failures remain distinct from rejected sign-ins", async () => {
  for (const [error, expected] of [[Object.assign(new Error("server 503"), { status: 503 }), "error"], [Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }), "unreachable"]]) {
    const multi = createMultiServerProvider([{ server: server("plex"), provider: { getPresence: async () => { throw error; } } }]);
    await assert.rejects(multi.getPresence());
    assert.equal(multi.servers()[0].reason, expected);
  }
});
