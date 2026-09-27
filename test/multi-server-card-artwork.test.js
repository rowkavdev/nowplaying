import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const servers = [
  { provider: "jellyfin", serverUrl: "http://127.0.0.1:18096", identity: { id: "one", displayName: "First" } },
  { provider: "jellyfin", serverUrl: "http://127.0.0.1:28096", identity: { id: "two", displayName: "Second" } },
];
const configFile = async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-artwork-collision-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ servers, credentialStored: true, discordEnabled: false }));
  return file;
};
const session = (user, title, paused) => [{
  UserId: user,
  PlayState: { IsPaused: paused, PositionTicks: 0 },
  NowPlayingItem: { Id: "common-id", Type: "Movie", Name: title, ImageTags: { Primary: "common-tag" }, RunTimeTicks: 100000 },
}];

// The second server finishes after the first, but the first server's playing
// item wins over its paused item. Its cover and credentials must win too.
test("selected Jellyfin server supplies card art despite colliding item IDs", async () => {
  const red = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  const artworkRequests = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    const second = target.port === "28096";
    if (target.pathname === "/Sessions") {
      if (second) await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json(session(second ? "two" : "one", second ? "Movie 2" : "Movie 1", second));
    }
    if (target.pathname.includes("/Images/Primary")) {
      artworkRequests.push({ port: target.port, token: options.headers["X-Emby-Token"] });
      return new Response(second ? blue : red, { status: 200, headers: { "content-type": "image/png" } });
    }
    throw Error(`Unexpected fixture path ${target.pathname}`);
  };
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: { read: async (ref) => `token-${ref.identityId}` }, port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
  try {
    const response = await fetch(`${app.url}/card.svg`);
    assert.equal(response.status, 200);
    const svg = await response.text();
    assert.match(svg, />Movie 1</);
    assert.doesNotMatch(svg, />Movie 2</);
    const embedded = svg.match(/<image[^>]*href="data:image\/png;base64,([^"]+)"/);
    assert.ok(embedded, "selected server's artwork is embedded");
    const image = await sharp(Buffer.from(embedded[1], "base64")).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...image.data.subarray(0, 3)], [255, 0, 0]);
    assert.deepEqual(artworkRequests, [{ port: "18096", token: "token-one" }]);
  } finally { await app.close(); }
});
