import test from "node:test";
import assert from "node:assert/strict";
import { createSettings, validateSettings } from "../src/settings.js";
import { artworkResolverOptions, createDiscordArtworkResolver } from "../src/discord-artwork.js";

test("Discord artwork proxy is off by default and metadata lookup stays disabled", () => {
  const settings = createSettings();
  assert.equal(settings.discord.artworkProxy, "");
  assert.deepEqual(artworkResolverOptions(settings.discord), { publicProxyBase: "", metadataLookup: false });
});

test("accepts a public HTTPS artwork proxy and feeds the resolver", async () => {
  const settings = createSettings({ discord: { artworkProxy: "https://art.example.com/discord" } });
  const resolver = createDiscordArtworkResolver(artworkResolverOptions(settings.discord));
  const result = await resolver.resolve({ artwork: { provider: "plex", type: "primary", itemId: "9" }, artworkUrl: "https://192.168.1.10:32400/photo" });
  assert.equal(result.strategy, "proxy");
  assert.match(result.image, /^https:\/\/art\.example\.com\/discord\/[0-9a-f]{32}$/);
});

test("rejects private, insecure, credentialed or query-bearing proxy URLs", () => {
  for (const artworkProxy of ["http://art.example.com", "https://192.168.1.10/art", "https://nas.local/art", "https://u:p@art.example.com", "https://art.example.com/p?token=1", 42]) {
    assert.throws(() => validateSettings({ discord: { artworkProxy } }), /discord\.artworkProxy/, String(artworkProxy));
  }
  assert.doesNotThrow(() => validateSettings({ discord: { artworkProxy: "" } }));
});
