import test from "node:test";
import assert from "node:assert/strict";
import { artworkResolverOptions, classifyArtworkUrl, createDiscordArtworkResolver, isPrivateHost } from "../src/discord-artwork.js";
import { createSetupConfig } from "../src/setup-config.js";

test("private IPv4, IPv6 and local names are never sent to Discord", () => {
  for (const host of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.9", "169.254.1.1", "100.64.0.1", "::1", "[fd00::1]", "fe80::1", "::ffff:192.168.0.2", "localhost", "nas", "jellyfin.local", "media.home.arpa"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ["8.8.8.8", "2606:4700::1111", "images.example.com"]) assert.equal(isPrivateHost(host), false, host);
});

test("classification rejects unsafe URLs with a failure class only", () => {
  assert.deepEqual(classifyArtworkUrl("http://images.example.com/a.jpg"), { ok: false, failure: "not_https" });
  assert.deepEqual(classifyArtworkUrl("https://user:pw@images.example.com/a.jpg"), { ok: false, failure: "credentials" });
  assert.deepEqual(classifyArtworkUrl("https://192.168.1.4:32400/photo"), { ok: false, failure: "private_host" });
  assert.deepEqual(classifyArtworkUrl("https://images.example.com/a.jpg?X-Plex-Token=abc"), { ok: false, failure: "secret_query" });
  assert.deepEqual(classifyArtworkUrl("https://images.example.com/a.jpg?api_key=abc"), { ok: false, failure: "secret_query" });
  assert.deepEqual(classifyArtworkUrl("nope"), { ok: false, failure: "invalid" });
  assert.deepEqual(classifyArtworkUrl("https://images.example.com/a.jpg?w=300#x"), { ok: true, url: "https://images.example.com/a.jpg?w=300" });
});

test("fallback order: provider, proxy, opt-in lookup, fallback asset", async () => {
  const artwork = { provider: "jellyfin", type: "primary", itemId: "abc" };
  const publicUrl = createDiscordArtworkResolver();
  assert.equal((await publicUrl.resolve({ artworkUrl: "https://cdn.example.com/a.png" })).strategy, "provider");

  const proxy = createDiscordArtworkResolver({ publicProxyBase: "https://art.example.com/d/" });
  const proxied = await proxy.resolve({ artwork, artworkUrl: "https://10.0.0.5/Items/abc" });
  assert.equal(proxied.strategy, "proxy");
  assert.equal(proxied.failure, "private_host");
  assert.match(proxied.image, /^https:\/\/art\.example\.com\/d\/[0-9a-f]{32}$/);
  assert.doesNotMatch(proxied.image, /10\.0\.0\.5|abc/);

  let calls = 0;
  const optedOut = createDiscordArtworkResolver({ lookup: () => { calls += 1; return "https://x.example.com/a.png"; } });
  assert.equal((await optedOut.resolve({ title: "Song", artist: "Band" })).strategy, "fallback");
  assert.equal(calls, 0, "metadata never leaves without opt-in");

  const optedIn = createDiscordArtworkResolver({ metadataLookup: true, lookup: async (q) => { calls += 1; assert.deepEqual(Object.keys(q).sort(), ["artist", "title"]); return "https://x.example.com/a.png"; } });
  assert.equal((await optedIn.resolve({ title: "Song", artist: "Band" })).strategy, "lookup");
  assert.equal(calls, 1);

  const failing = createDiscordArtworkResolver({ metadataLookup: true, lookup: async () => { throw new Error("secret-host.lan down"); } });
  const fell = await failing.resolve({ title: "Song" });
  assert.deepEqual({ image: fell.image, strategy: fell.strategy, failure: fell.failure }, { image: "media", strategy: "fallback", failure: "lookup_error" });
  assert.doesNotMatch(JSON.stringify(failing.status()), /secret-host/);
});

test("successes and misses are cached with bounded TTL and size", async () => {
  let t = 0;
  let calls = 0;
  const resolver = createDiscordArtworkResolver({ metadataLookup: true, lookup: async () => { calls += 1; return null; }, negativeTtlMs: 5_000, maxEntries: 2, now: () => t });
  await resolver.resolve({ title: "A" });
  assert.equal((await resolver.resolve({ title: "A" })).cached, true);
  assert.equal(calls, 1);
  t = 6_000;
  await resolver.resolve({ title: "A" });
  assert.equal(calls, 2, "negative entry expires");
  await resolver.resolve({ title: "B" });
  await resolver.resolve({ title: "C" });
  assert.equal(resolver.size(), 2);
});

test("options are validated", () => {
  assert.throws(() => createDiscordArtworkResolver({ publicProxyBase: "https://192.168.0.2/p" }), TypeError);
  assert.throws(() => createDiscordArtworkResolver({ publicProxyBase: "https://art.example.com/p?token=1" }), TypeError);
  assert.throws(() => createDiscordArtworkResolver({ metadataLookup: true }), TypeError);
  assert.throws(() => createDiscordArtworkResolver({ fallbackAsset: "bad key" }), TypeError);
  assert.throws(() => createDiscordArtworkResolver({ maxEntries: 0 }), RangeError);
});

test("a new setup config turns the Cover Art Archive lookup on: hit, miss and off", async () => {
  const base = { provider: "jellyfin", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };
  const cover = "https://coverartarchive.org/release/00000000-0000-4000-8000-000000000001/front-250";
  const track = { title: "Song", artist: "Band", artworkUrl: "http://192.168.1.20:8096/Items/1/Images/Primary" };
  const on = createSetupConfig({ ...base, discordArtworkLookup: "musicbrainz" }).discord;
  const hit = createDiscordArtworkResolver(artworkResolverOptions(on, { createLookup: () => async () => cover }));
  assert.deepEqual(await hit.resolve(track).then((r) => [r.image, r.strategy]), [cover, "lookup"]);
  const miss = createDiscordArtworkResolver(artworkResolverOptions(on, { createLookup: () => async () => null }));
  assert.deepEqual(await miss.resolve(track).then((r) => [r.image, r.strategy, r.failure]), ["media", "fallback", "not_https"]);
  let called = false;
  const off = createDiscordArtworkResolver(artworkResolverOptions(createSetupConfig({ ...base, discordArtworkLookup: "off" }).discord, { createLookup: () => async () => { called = true; return cover; } }));
  assert.deepEqual(await off.resolve(track).then((r) => [r.image, r.strategy]), ["media", "fallback"]);
  assert.equal(called, false);
});
