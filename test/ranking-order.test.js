import test from "node:test";
import assert from "node:assert/strict";
import { createMultiServerProvider } from "../src/multi-server.js";
import { combinePresence } from "../src/spotify-source.js";
import { createYouTubeBridge } from "../src/youtube-bridge.js";

// Activity ranking must follow receive order, never adjustable wall-clock
// time: NTP corrections or a manually changed clock must not reshuffle which
// playback the card and Discord show (#619, 0bb954e, d4b83f9, 21c140f).

const serverEntry = (provider) => ({ server: { provider, identity: { id: "x", displayName: "Rowan" } } });

test("multi-server: a frozen wall clock still ranks the most recent starter first", async () => {
  const a = { presence: { state: "playing", kind: "track", title: "A" }, getPresence: async function () { return this.presence; } };
  const b = { presence: { state: "playing", kind: "track", title: "B" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: b }], { now: () => 42 });
  await multi.getPresence();
  assert.equal((await multi.getPresence()).title, "B");
});

test("multi-server: a backward wall-clock correction cannot make an older start win", async () => {
  let t = 5000;
  const a = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const b = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: b }], { now: () => t });
  await multi.getPresence();
  a.presence = { state: "playing", kind: "track", title: "A" };
  await multi.getPresence();
  t = 1000; // clock rolls back before B starts
  b.presence = { state: "playing", kind: "track", title: "B" };
  assert.equal((await multi.getPresence()).title, "B");
});

test("multi-server: playing beats a newer paused, continuing an item keeps priority, a resume re-bumps", async () => {
  const a = { presence: { state: "playing", kind: "track", title: "A" }, getPresence: async function () { return this.presence; } };
  const b = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: b }], { now: () => 7 });
  await multi.getPresence(); // A starts
  b.presence = { state: "playing", kind: "track", title: "B" };
  await multi.getPresence(); // B starts (newer)
  a.presence = { state: "playing", kind: "track", title: "A" };
  assert.equal((await multi.getPresence()).title, "B", "A continuing the same item does not re-bump");
  b.presence = { state: "paused", kind: "track", title: "B" };
  assert.equal((await multi.getPresence()).title, "A", "playing beats paused");
  b.presence = { state: "playing", kind: "track", title: "B" };
  assert.equal((await multi.getPresence()).title, "B", "a resume re-bumps");
});

test("multi-server: a down server is skipped and wins again once it recovers with newer activity", async () => {
  const a = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const down = { getPresence: async () => { throw new Error("down"); } };
  const c = { presence: { state: "playing", kind: "track", title: "C" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: down }, { ...serverEntry("emby"), provider: c }], { now: () => 9 });
  assert.equal((await multi.getPresence()).title, "C");
  a.presence = { state: "playing", kind: "track", title: "A-new" };
  assert.equal((await multi.getPresence()).title, "A-new");
});

test("multi-server: distinct media IDs outrank same-title playback without progress re-bumps (#700)", async () => {
  const song = (itemId, positionMs = 0, imageTag = "cover-v1") => ({
    state: "playing", kind: "track", title: "Intro", subtitle: "Same Artist", positionMs,
    artwork: { provider: "jellyfin", itemId, imageTag, type: "primary" },
  });
  const a = { presence: song("album-one-track"), getPresence: async function () { return this.presence; } };
  const b = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("jellyfin"), provider: a }, { ...serverEntry("plex"), provider: b }]);
  await multi.getPresence();
  b.presence = { state: "playing", kind: "track", title: "Other" };
  assert.equal((await multi.getPresence()).title, "Other");
  a.presence = song("album-one-track", 5000, "cover-v2");
  assert.equal((await multi.getPresence()).title, "Other", "progress and a refreshed image tag do not count as a new item");
  a.presence = song("album-two-track");
  assert.equal((await multi.getPresence()).artwork.itemId, "album-two-track", "different media ID wins despite the same display text");
});

test("combinePresence: a distinct server media ID overtakes Spotify at the same title (#700)", async () => {
  const server = { value: { state: "playing", kind: "track", title: "Intro", subtitle: "Same Artist", artwork: { provider: "jellyfin", itemId: "one", type: "primary" } }, getPresence: async function () { return this.value; } };
  const spotify = { value: { state: "idle" }, getPresence: async function () { return this.value; } };
  const card = combinePresence({ primary: server, secondary: spotify });
  await card.getPresence();
  spotify.value = { state: "playing", kind: "track", title: "Other" };
  assert.equal((await card.getPresence()).title, "Other");
  server.value = { ...server.value, positionMs: 10000 };
  assert.equal((await card.getPresence()).title, "Other", "position alone keeps older order");
  server.value = { ...server.value, artwork: { provider: "jellyfin", itemId: "two", type: "primary" } };
  assert.equal((await card.getPresence()).artwork.itemId, "two");
});

test("multi-server: no media item ID falls back to display identity (#700)", async () => {
  const a = { presence: { state: "playing", kind: "track", title: "Intro", subtitle: "Artist" }, getPresence: async function () { return this.presence; } };
  const b = { presence: { state: "idle" }, getPresence: async function () { return this.presence; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: b }]);
  await multi.getPresence();
  b.presence = { state: "playing", kind: "track", title: "Other" };
  await multi.getPresence();
  a.presence = { ...a.presence, positionMs: 3000 };
  assert.equal((await multi.getPresence()).title, "Other");
  a.presence = { ...a.presence, subtitle: "Another Artist" };
  assert.equal((await multi.getPresence()).title, "Intro");
});

test("combinePresence: the most recent starter wins, an unchanged item keeps priority", async () => {
  const server = { value: { state: "playing", kind: "track", title: "Server A" }, getPresence: async function () { return this.value; } };
  const spotify = { value: { state: "idle" }, getPresence: async function () { return this.value; } };
  const card = combinePresence({ primary: server, secondary: spotify });
  await card.getPresence();
  spotify.value = { state: "playing", kind: "track", title: "Spotify B" };
  assert.equal((await card.getPresence()).title, "Spotify B");
  assert.equal((await card.getPresence()).title, "Spotify B", "same item polling again keeps priority");
  server.value = { state: "playing", kind: "track", title: "Server C" };
  assert.equal((await card.getPresence()).title, "Server C", "a newer item on the other side overtakes");
});

test("combinePresence: a side that stops resets, playing beats paused, both idle shows the server state", async () => {
  const server = { value: { state: "playing", kind: "track", title: "Server" }, getPresence: async function () { return this.value; } };
  const spotify = { value: { state: "playing", kind: "track", title: "Spotify" }, getPresence: async function () { return this.value; } };
  const card = combinePresence({ primary: server, secondary: spotify });
  spotify.value = { state: "idle" };
  assert.equal((await card.getPresence()).title, "Server");
  spotify.value = { state: "playing", kind: "track", title: "Spotify" };
  assert.equal((await card.getPresence()).title, "Spotify", "a restart wins the newer order");
  spotify.value = { state: "paused", kind: "track", title: "Spotify" };
  assert.equal((await card.getPresence()).title, "Server", "playing beats paused");
  server.value = { state: "idle" };
  spotify.value = { state: "idle" };
  assert.equal((await card.getPresence()).state, "idle");
});

test("nested source selection keeps the original start order when the newer inner source stops", async () => {
  const source = (title) => ({ value: { state: "idle" }, getPresence: async function () { return this.value; }, play() { this.value = { state: "playing", kind: "track", title }; } });
  const server = source("Server");
  const spotify = source("Spotify");
  const youtube = source("YouTube");
  const card = combinePresence({ primary: combinePresence({ primary: server, secondary: spotify }), secondary: youtube });
  server.play();
  assert.equal((await card.getPresence()).title, "Server");
  youtube.play();
  assert.equal((await card.getPresence()).title, "YouTube");
  spotify.play();
  assert.equal((await card.getPresence()).title, "Spotify");
  spotify.value = { state: "idle" };
  assert.equal((await card.getPresence()).title, "YouTube", "the older server did not start again when Spotify stopped");
  server.value = { state: "paused", kind: "track", title: "Server" };
  await card.getPresence();
  server.play();
  assert.equal((await card.getPresence()).title, "Server", "an actual resume still outranks YouTube");
});

test("combined multi-server selection preserves original activity when falling back to an older server", async () => {
  const a = { value: { state: "playing", kind: "track", title: "Older server" }, getPresence: async function () { return this.value; } };
  const b = { value: { state: "idle" }, getPresence: async function () { return this.value; } };
  const youtube = { value: { state: "idle" }, getPresence: async function () { return this.value; } };
  const multi = createMultiServerProvider([{ ...serverEntry("plex"), provider: a }, { ...serverEntry("jellyfin"), provider: b }]);
  const card = combinePresence({ primary: multi, secondary: youtube });
  await card.getPresence();
  youtube.value = { state: "playing", kind: "track", title: "YouTube" };
  assert.equal((await card.getPresence()).title, "YouTube");
  b.value = { state: "playing", kind: "track", title: "Newer server" };
  assert.equal((await card.getPresence()).title, "Newer server");
  b.value = { state: "idle" };
  assert.equal((await card.getPresence()).title, "YouTube", "falling back to the older server retains its original priority");
  a.value = { state: "playing", kind: "track", title: "Actually new item" };
  assert.equal((await card.getPresence()).title, "Actually new item");
});

const token = "t".repeat(40);
const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const headers = { origin, authorization: `Bearer ${token}` };
const video = (tabId, title, state = "playing") => ({ tabId, videoId: "dQw4w9WgXcQ", title, channel: "A channel", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", positionMs: 5000, durationMs: 200000, state, music: true });

test("closing the newer YouTube tab preserves the older tab's priority on cards and Discord", async () => {
  const { youtubeForDiscord } = await import("../src/app-config.js");
  for (const wrap of [(source) => source, youtubeForDiscord]) {
    const server = { value: { state: "idle" }, getPresence: async function () { return this.value; } };
    const bridge = createYouTubeBridge({ token, elapsedNow: () => 0 });
    const card = combinePresence({ primary: server, secondary: wrap(bridge.provider) });
    const send = (tab, title, state = "playing") => bridge.receive({ method: "POST", headers, body: { ...video(tab, title, state), music: false } });
    send("older", "Older tab");
    assert.equal((await card.getPresence()).title, "Older tab");
    server.value = { state: "playing", kind: "track", title: "Server" };
    assert.equal((await card.getPresence()).title, "Server");
    send("newer", "Newer tab");
    const presence = await card.getPresence();
    assert.equal(presence.title, "Newer tab");
    assert.deepEqual(Object.getOwnPropertySymbols(presence), [], "internal activity metadata stays off public presences");
    bridge.receive({ method: "POST", headers, body: { tabId: "newer", state: "stopped" } });
    assert.equal((await card.getPresence()).title, "Server", "the older tab did not restart when the newer tab closed");
    send("older", "Older tab", "paused");
    await card.getPresence();
    send("older", "Older tab");
    assert.equal((await card.getPresence()).title, "Older tab", "an actual resume gets a new priority");
  }
});

test("youtube bridge: a backward wall-clock correction cannot make an older tab win (#619)", async () => {
  let t = 10000;
  const b = createYouTubeBridge({ token, now: () => t });
  b.receive({ method: "POST", headers, body: video("tabA", "Song A") });
  t = 5000; // clock rolls back before tab B starts
  b.receive({ method: "POST", headers, body: video("tabB", "Song B") });
  assert.equal((await b.provider.getPresence()).title, "Song B");
});

test("youtube bridge: a frozen wall clock still ranks the newest tab first (#619)", async () => {
  const b = createYouTubeBridge({ token, now: () => 1000 });
  b.receive({ method: "POST", headers, body: video("tabA", "Song A") });
  b.receive({ method: "POST", headers, body: video("tabB", "Song B") });
  assert.equal((await b.provider.getPresence()).title, "Song B");
});

test("youtube bridge: paused tabs fall back by receive order under a frozen or backward clock (#619)", async () => {
  let t = 1000;
  const b = createYouTubeBridge({ token, now: () => t });
  b.receive({ method: "POST", headers, body: video("tabA", "Song A", "paused") });
  b.receive({ method: "POST", headers, body: video("tabB", "Song B", "paused") });
  assert.equal((await b.provider.getPresence()).title, "Song B");
  t = 500;
  b.receive({ method: "POST", headers, body: video("tabA", "Song A", "paused") });
  assert.equal((await b.provider.getPresence()).title, "Song A");
});

test("youtube bridge: playing beats a newer paused tab and a resume re-bumps (#619)", async () => {
  const b = createYouTubeBridge({ token, now: () => 1000 });
  b.receive({ method: "POST", headers, body: video("tabA", "Song A") });
  b.receive({ method: "POST", headers, body: video("tabB", "Song B") });
  assert.equal((await b.provider.getPresence()).title, "Song B");
  b.receive({ method: "POST", headers, body: video("tabB", "Song B", "paused") });
  assert.equal((await b.provider.getPresence()).title, "Song A", "playing beats paused");
  b.receive({ method: "POST", headers, body: video("tabB", "Song B") });
  assert.equal((await b.provider.getPresence()).title, "Song B", "a resume re-bumps");
  b.receive({ method: "POST", headers, body: video("tabA", "Song A") });
  assert.equal((await b.provider.getPresence()).title, "Song B", "continuing the same item does not re-bump");
});
