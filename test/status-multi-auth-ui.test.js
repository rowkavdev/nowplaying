import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createMultiServerProvider } from "../src/multi-server.js";
import { createAppStatus } from "../src/app-status.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";

// Run the real status page script against the real aggregate/per-server status
// pipeline so a healthy second server cannot mask a revoked first sign-in.
test("status page tells users to re-sign in when one of two servers returns 401", async () => {
  const config = { provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u1", displayName: "User" }, servers: [
    { provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u1", displayName: "User" } },
    { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u2", displayName: "Other" } },
  ] };
  const multi = createMultiServerProvider([
    { server: config.servers[0], provider: { getPresence: async () => { throw Object.assign(new Error("private token revoked"), { status: 401 }); } } },
    { server: config.servers[1], provider: { getPresence: async () => ({ state: "playing", kind: "track", title: "Song" }) } },
  ]);
  const status = createAppStatus({ config });
  status.wrapProvider(multi);
  status.setServers(() => multi.servers());
  const handle = createStatusPageHandler({ status, fallback: async () => null });
  const response = await handle({ url: "/api/status" });
  const snapshot = JSON.parse(response.body);
  assert.equal(snapshot.server.state, "connected");
  assert.deepEqual(snapshot.servers.map((row) => [row.state, row.reason]), [["error", "unauthorized"], ["playing", null]]);
  assert.doesNotMatch(response.body, /private token revoked/);

  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", className: "", hidden: false, src: "", children: [], addEventListener() {}, replaceChildren(...items) { this.children = items; } });
    return nodes.get(id);
  };
  const script = (await handle({ url: "/status.js" })).body;
  runInNewContext(script, {
    document: { getElementById: get, createElement: () => ({ textContent: "" }) },
    fetch: async () => ({ ok: true, json: async () => snapshot }),
    Date, setInterval() {}, navigator: { clipboard: { writeText: async () => {} } },
  });
  for (let i = 0; i < 10 && !get("servers").children.length; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get("summary").textContent, "Something needs attention - see below.");
  assert.equal(get("summary").className, "bad");
  assert.equal(get("servers-block").hidden, false);
  assert.match(get("servers").children[0].textContent, /Plex as User - sign-in rejected, run setup again/);
  assert.match(get("servers").children[1].textContent, /Jellyfin as Other - playing/);
  assert.doesNotMatch(get("servers").children[0].textContent, /can't reach|private token/);
});
