import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";

test("polls and maps the selected Plex user session", async () => {
  let request;
  const provider = createPlexProvider({
    baseUrl: "http://plex.test/",
    token: "secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return { MediaContainer: { Metadata: [
            { title: "Other", type: "movie", User: { title: "Sam" } },
            {
              title: "Arrival", type: "movie", year: 2016, viewOffset: 5, duration: 10,
              thumb: "/library/metadata/1/thumb", User: { username: "Rowan" },
              Player: { state: "paused" },
            },
          ] } };
        },
      };
    },
  });

  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(request.url, "http://plex.test/status/sessions");
  assert.equal(request.init.headers["X-Plex-Token"], "secret");
  assert.equal(presence.state, "paused");
  assert.equal(presence.kind, "movie");
  assert.equal(presence.title, "Arrival");
  assert.equal(presence.subtitle, "2016");
  assert.match(presence.artworkUrl, /X-Plex-Token=secret/);
});

test("returns idle when no matching session exists", async () => {
  const provider = createPlexProvider({
    baseUrl: "https://plex.test",
    token: "secret",
    fetchImpl: async () => ({ ok: true, json: async () => ({ MediaContainer: {} }) }),
  });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(presence.state, "idle");
});

test("surfaces Plex HTTP failures", async () => {
  const provider = createPlexProvider({
    baseUrl: "https://plex.test",
    token: "secret",
    fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized" }),
  });
  await assert.rejects(provider.getPresence(), /401 Unauthorized/);
});
