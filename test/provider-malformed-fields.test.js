import test from "node:test";
import assert from "node:assert/strict";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";

const makers = { jellyfin: createJellyfinProvider, emby: createEmbyProvider };

function presenceFor(make, item, session = {}, context = {}) {
  const fetchImpl = async () => new Response(JSON.stringify([{ UserId: "u1", UserName: "rowan", NowPlayingItem: item, PlayState: {}, ...session }]), { status: 200, headers: { "content-type": "application/json" } });
  return make({ baseUrl: "http://media.test:8096", apiKey: "k", fetchImpl }).getPresence(context);
}

for (const [name, make] of Object.entries(makers)) {
  test(`${name}: a single Artists string is shown as the artist`, async () => {
    assert.equal((await presenceFor(make, { Type: "Audio", Name: "Song", Artists: "Solo Artist" })).subtitle, "Solo Artist");
  });

  test(`${name}: blank or non-string artists are skipped, then the album artist is used`, async () => {
    assert.equal((await presenceFor(make, { Type: "Audio", Name: "Song", Artists: [7, " ", "A", null, "B"] })).subtitle, "A, B");
    assert.equal((await presenceFor(make, { Type: "Audio", Name: "Song", Artists: [], AlbumArtist: "Group" })).subtitle, "Group");
    assert.equal((await presenceFor(make, { Type: "Audio", Name: "Song", Artists: [], AlbumArtist: 5 })).subtitle, null);
  });

  test(`${name}: a non-string title, series or image tag drops that field instead of failing the poll`, async () => {
    const odd = await presenceFor(make, { Type: "Episode", Name: 42, SeriesName: 7, SeasonName: "Season 1", Id: "e1", ImageTags: { Primary: 5 } });
    assert.equal(odd.title, null);
    assert.equal(odd.subtitle, "Season 1");
    assert.equal(odd.artwork, null);
    assert.equal(odd.kind, "episode");
  });

  test(`${name}: another user's session with a non-string name doesn't break name matching`, async () => {
    const fetchImpl = async () => new Response(JSON.stringify([
      { UserId: "x", UserName: 5, NowPlayingItem: { Type: "Audio", Name: "Other" }, PlayState: {} },
      { UserId: "u1", UserName: "Rowan", NowPlayingItem: { Type: "Audio", Name: "Mine" }, PlayState: {} },
    ]), { status: 200, headers: { "content-type": "application/json" } });
    const presence = await make({ baseUrl: "http://media.test:8096", apiKey: "k", fetchImpl }).getPresence({ username: "rowan" });
    assert.equal(presence.title, "Mine");
  });

  test(`${name}: well-formed artwork and years are unchanged`, async () => {
    const p = await presenceFor(make, { Type: "Movie", Name: "Film", ProductionYear: 1999, Id: "m1", ImageTags: { Primary: "tag1" } });
    assert.deepEqual({ provider: p.artwork.provider, itemId: p.artwork.itemId, imageTag: p.artwork.imageTag, type: p.artwork.type }, { provider: name, itemId: "m1", imageTag: "tag1", type: "primary" });
    assert.equal(p.subtitle, "1999");
    assert.equal(p.year, 1999);
  });
}

for (const [name, make] of Object.entries(makers)) {
  test(`${name}: an overlong artwork item ID drops artwork without failing playback`, async () => {
    const presence = await presenceFor(make, { Type: "Audio", Name: "Song", Id: "i".repeat(513), ImageTags: { Primary: "tag" } });
    assert.equal(presence.state, "playing");
    assert.equal(presence.title, "Song");
    assert.equal(presence.artwork, null);
  });

  test(`${name}: an artwork item ID at the 512-character boundary remains usable`, async () => {
    const id = "i".repeat(512);
    const presence = await presenceFor(make, { Type: "Audio", Name: "Song", Id: id, ImageTags: { Primary: "tag" } });
    assert.deepEqual(presence.artwork, { provider: name, itemId: id, imageId: null, imageTag: "tag", type: "primary" });
  });
}
