import test from "node:test";
import assert from "node:assert/strict";
import { createMultiServerProvider } from "../src/multi-server.js";

const server = (provider, displayName = "Rowan") => ({ provider, identity: { id: "x", displayName } });

test("polls every server together and returns the first server's presence (#252)", async () => {
  let calls = 0;
  const playing = { state: "playing", kind: "track", title: "Song" };
  const multi = createMultiServerProvider([
    { server: server("jellyfin"), provider: { getPresence: async () => { calls += 1; return { state: "idle" }; } } },
    { server: server("plex"), provider: { getPresence: async () => { calls += 1; return playing; } } },
  ], { now: () => 42 });
  assert.deepEqual(multi.servers().map((s) => s.state), ["waiting", "waiting"]);
  const [a, b] = await Promise.all([multi.getPresence(), multi.getPresence()]);
  assert.deepEqual([a, b], [{ state: "idle" }, { state: "idle" }]);
  assert.equal(calls, 2, "callers at the same moment share one round");
  assert.deepEqual(multi.servers(), [
    { provider: "jellyfin", displayName: "Rowan", state: "idle", checkedAt: 42 },
    { provider: "plex", displayName: "Rowan", state: "playing", checkedAt: 42 },
  ]);
});

test("a failing first server fails like before; a failing other server only shows on its own row (#252)", async () => {
  const down = Object.assign(new Error("secret http://10.0.0.2 detail"), { code: "unreachable" });
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

test("needs at least one server with a provider (#252)", () => {
  assert.throws(() => createMultiServerProvider([]), /at least one server/);
  assert.throws(() => createMultiServerProvider([{ server: server("plex") }]), /needs a provider/);
  assert.throws(() => createMultiServerProvider([{ provider: { getPresence: async () => ({}) } }]), /needs its server/);
});
