import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { presenceItemKey } from "../src/presence-identity.js";
import { createMultiServerProvider } from "../src/multi-server.js";
import { createHostedLoop } from "../src/hosted-loop.js";
import { createDiscordPresenceLoop } from "../src/discord-presence.js";

const base = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 0, durationMs: 600_000 };
function artwork(sourceIndex, imageOnly = false, imageTag = "v1") {
  return imageOnly
    ? { provider: "plex", imageId: "/library/metadata/1/thumb", type: "thumb", sourceIndex }
    : { provider: "jellyfin", itemId: "1", imageTag, type: "primary", sourceIndex };
}

for (const imageOnly of [false, true]) {
  test(`source distinguishes colliding ${imageOnly ? "cover" : "item"} IDs`, () => {
    assert.notEqual(presenceItemKey({ ...base, artwork: artwork(0, imageOnly) }), presenceItemKey({ ...base, artwork: artwork(1, imageOnly) }));
  });
  for (const kind of ["hosted", "Discord"]) {
    test(`${kind} gives a newly selected server its own frozen-position window (${imageOnly ? "cover" : "item"})`, async () => {
      let time = 0, selected = 0;
      const multi = createMultiServerProvider([0, 1].map(index => ({
        server: { provider: imageOnly ? "plex" : "jellyfin" },
        provider: { getPresence: async () => createPresence(index === selected ? { ...base, artwork: artwork(index, imageOnly) } : { state: "idle" }) },
      })));
      const sent = [];
      const loop = kind === "hosted"
        ? createHostedLoop({ getPresence: () => multi.getPresence(), elapsedNow: () => time, uploader: { push: async value => { sent.push(value); return { sent: true }; } } })
        : createDiscordPresenceLoop({ getPresence: () => multi.getPresence(), now: () => time, client: { publish: async value => { sent.push(value); return true; } } });
      await loop.tick();
      time = 300_000;
      selected = 1;
      assert.equal((await multi.getPresence()).artwork.sourceIndex, 1);
      const fresh = await loop.tick();
      if (kind === "hosted") {
        assert.equal(fresh.cleared, undefined);
        assert.equal(sent.at(-1).state, "playing");
        assert.equal(sent.at(-1).artwork.sourceIndex, 1);
      } else {
        assert.equal(fresh.action, "publish");
        assert.equal(fresh.stalled, undefined);
        assert.notEqual(sent.at(-1), null);
      }
      time += 299_999;
      const almost = await loop.tick();
      assert.notEqual(kind === "hosted" ? almost.cleared : almost.action, kind === "hosted" ? "stuck" : "clear");
      time++;
      const expired = await loop.tick();
      assert.equal(kind === "hosted" ? expired.cleared : expired.action, kind === "hosted" ? "stuck" : "clear");
      assert.equal(kind === "hosted" ? sent.at(-1).state : sent.at(-1), kind === "hosted" ? "idle" : null);
    });
  }
}

test("same-source artwork revisions and shared covers are still the same item", () => {
  assert.equal(presenceItemKey({ ...base, artwork: artwork(1, false, "v1") }), presenceItemKey({ ...base, artwork: artwork(1, false, "v2") }));
  assert.equal(presenceItemKey({ ...base, artwork: artwork(1, true) }), presenceItemKey({ ...base, artwork: { ...artwork(1, true), imageId: "/new/cover" } }));
});

test("untagged keys retain their original shape and invalid indexes are ignored", () => {
  const plain = { ...base, artwork: { provider: "jellyfin", itemId: " 1 " } };
  assert.equal(presenceItemKey(plain), JSON.stringify(["track", "Song", "Artist", ["jellyfin", "1"]]));
  assert.equal(presenceItemKey(base), JSON.stringify(["track", "Song", "Artist", null]));
  for (const sourceIndex of [undefined, null, -1, 8, 0.5, "1"]) {
    assert.equal(presenceItemKey({ ...plain, artwork: { ...plain.artwork, sourceIndex } }), presenceItemKey(plain));
  }
});
