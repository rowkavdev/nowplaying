import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";

const sessions = () => new Response(JSON.stringify({ MediaContainer: { Metadata: [
  { User: { id: "1" }, type: "track", title: "Owner song", Player: { state: "playing" } },
] } }));
const context = { userId: "42" };

for (const status of [200, 403]) {
  for (const mode of ["settled", "pending", "rejecting", "throwing"]) {
    test(`Plex owner ${status} discards unread body without waiting (${mode})`, async () => {
      let cancels = 0, pulls = 0, timer;
      const body = new ReadableStream({
        pull() { pulls++; },
        cancel() {
          cancels++;
          if (mode === "pending") return new Promise(() => {});
          if (mode === "rejecting") return Promise.reject(new Error("cleanup rejected"));
          if (mode === "throwing") throw new Error("cleanup threw");
        },
      }, { highWaterMark: 0 });
      const provider = createPlexProvider({ baseUrl: "http://plex.fixture", token: "private-token", fetchImpl: async url => url.endsWith("/accounts") ? new Response(body, { status }) : sessions() });
      try {
        const presence = await Promise.race([
          provider.getPresence(context),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cleanup blocked")), 150); }),
        ]);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(presence.state, status === 200 ? "playing" : "idle");
        assert.equal(presence.title, status === 200 ? "Owner song" : null);
        assert.equal(cancels, 1);
        assert.equal(pulls, 0);
        assert.equal(body.locked, false);
      } finally { clearTimeout(timer); }
    });
  }
}

test("owner authorization is cached after success, retried after rejection", async () => {
  let accounts = 0, cancels = 0;
  const provider = createPlexProvider({ baseUrl: "http://plex.fixture", token: "private-token", fetchImpl: async url => {
    if (!url.endsWith("/accounts")) return sessions();
    accounts++;
    return new Response(new ReadableStream({ cancel() { cancels++; } }, { highWaterMark: 0 }), { status: accounts === 1 ? 403 : 200 });
  } });
  assert.equal((await provider.getPresence(context)).state, "idle");
  assert.equal((await provider.getPresence(context)).state, "playing");
  assert.equal((await provider.getPresence(context)).state, "playing");
  assert.equal(accounts, 2);
  assert.equal(cancels, 2);
});

test("synchronous adapter cancellation throw cannot deny an authorized owner", async () => {
  let cancels = 0;
  const provider = createPlexProvider({ baseUrl: "http://plex.fixture", token: "private-token", fetchImpl: async url => url.endsWith("/accounts")
    ? { ok: true, status: 200, body: { cancel() { cancels++; throw new Error("cleanup"); } } }
    : sessions() });
  assert.equal((await provider.getPresence(context)).state, "playing");
  assert.equal(cancels, 1);
});

test("failed owner network request retries and never authorizes by itself", async () => {
  let accounts = 0;
  const provider = createPlexProvider({ baseUrl: "http://plex.fixture", token: "private-token", fetchImpl: async url => {
    if (!url.endsWith("/accounts")) return sessions();
    accounts++;
    if (accounts === 1) throw new Error("offline");
    return new Response(null, { status: 200 });
  } });
  assert.equal((await provider.getPresence(context)).state, "idle");
  assert.equal((await provider.getPresence(context)).state, "playing");
  assert.equal(accounts, 2);
});
