import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";

const reply = (body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const plex = (metadata, context) => createPlexProvider({ baseUrl: "http://plex.test:32400", token: "t", fetchImpl: reply({ MediaContainer: { Metadata: metadata } }) }).getPresence(context);
const navidrome = (body, context) => createNavidromeProvider({ baseUrl: "http://nd.test:4533", username: "u", token: "t", salt: "s", fetchImpl: reply(body) }).getPresence(context);
const entry = (fields) => ({ "subsonic-response": { status: "ok", nowPlaying: { entry: { title: "Song", username: "u", ...fields } } } });

test("plex: a non-string title, subtitle or thumb drops that field instead of failing the poll", async () => {
  const p = await plex([{ type: "track", title: 1999, grandparentTitle: 4, originalTitle: "Cover Band", thumb: 5, User: { id: "1" } }]);
  assert.equal(p.title, null);
  assert.equal(p.subtitle, "Cover Band");
  assert.equal(p.artwork, null);
});

test("plex: an object year is not shown as [object Object]", async () => {
  assert.equal((await plex([{ type: "movie", title: "Film", year: {} }])).subtitle, null);
  assert.equal((await plex([{ type: "movie", title: "Film", year: 1999 }])).subtitle, "1999");
});

test("plex: a session whose user title is not a string doesn't break name matching", async () => {
  const p = await plex([{ type: "track", title: "Other", User: { title: 5 } }, { type: "track", title: "Mine", User: { title: "Rowan" } }], { username: "rowan" });
  assert.equal(p.title, "Mine");
});

test("plex: well-formed artwork is unchanged", async () => {
  const p = await plex([{ type: "track", title: "Song", thumb: "/library/metadata/1/thumb/2" }]);
  assert.equal(p.artwork.imageId, "/library/metadata/1/thumb/2");
  assert.equal(p.artwork.type, "thumb");
});

test("navidrome: a JSON null or non-object reply means nothing playing, not a TypeError", async () => {
  for (const body of ["null", "[]", '"x"', "7"]) assert.equal((await navidrome(body)).state, "idle", body);
});

test("navidrome: non-string title, artist, cover or username drops that field", async () => {
  const p = await navidrome(entry({ title: 5, artist: 7, album: "Album", coverArt: 12 }));
  assert.equal(p.title, null);
  assert.equal(p.subtitle, "Album");
  assert.equal(p.artwork, null);
  const matched = await navidrome({ "subsonic-response": { nowPlaying: { entry: [{ title: "Other", username: 5 }, { title: "Mine", username: "U" }] } } }, { username: "u" });
  assert.equal(matched.title, "Mine");
});

test("navidrome: a negative duration is unknown, and normal tracks keep theirs", async () => {
  assert.equal((await navidrome(entry({ duration: -3 }))).durationMs, null);
  assert.equal((await navidrome(entry({ duration: 215, coverArt: "al-1" }))).durationMs, 215000);
  assert.equal((await navidrome(entry({ coverArt: "al-1" }))).artwork.imageId, "al-1");
});
