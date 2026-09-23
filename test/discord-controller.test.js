import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_ARTWORK_URL } from "../src/discord-artwork.js";
import { createDiscordController } from "../src/discord-controller.js";

const playing = {
  state: "playing",
  kind: "track",
  title: "Example track",
  subtitle: "Example artist",
  positionMs: 30_000,
  durationMs: 180_000,
  updatedAt: "2026-09-22T12:00:30.000Z",
};

test("previews the exact Discord payload without publishing", () => {
  const calls = [];
  const controller = createDiscordController({
    client: { publish: async (activity) => calls.push(activity) },
    settings: { details: "Playing {title}", state: "by {subtitle}", timestamps: "none" },
  });

  assert.deepEqual(controller.preview(playing), {
    type: "listening",
    details: "Playing Example track",
    state: "by Example artist",
    largeImage: FALLBACK_ARTWORK_URL,
    largeText: "Playing",
  });
  assert.deepEqual(calls, []);
});

test("publishes the same activity shown by preview", async () => {
  const calls = [];
  const controller = createDiscordController({
    client: { publish: async (activity) => { calls.push(activity); return true; } },
    settings: { timestamps: "none" },
  });
  const preview = controller.preview(playing);
  const result = await controller.publish(playing);

  assert.deepEqual(calls, [preview]);
  assert.deepEqual(result, { activity: preview, published: true });
  assert.equal(Object.isFrozen(result), true);
});

test("clears Discord independently of provider state", async () => {
  const calls = [];
  const controller = createDiscordController({
    client: { publish: async (activity) => { calls.push(activity); return true; } },
  });

  assert.equal(await controller.clear(), true);
  assert.deepEqual(calls, [null]);
});

test("reports deferred publish without changing the preview", async () => {
  const controller = createDiscordController({
    client: { publish: async () => false },
    settings: { timestamps: "none" },
  });
  const result = await controller.publish(playing);
  assert.equal(result.published, false);
  assert.equal(result.activity.details, "Example track");
});

test("requires the resilient Discord client contract", () => {
  assert.throws(() => createDiscordController(), /client.publish is required/);
});


test("publishes a resolved public artwork URL and reports only strategy", async () => {
  const calls = [];
  const controller = createDiscordController({
    client: { publish: async (activity) => { calls.push(activity); return true; } },
    settings: { timestamps: "none" },
    artwork: { resolve: async () => ({ image: "https://art.example.com/d/abc", strategy: "proxy", failure: "private_host" }) },
  });
  const result = await controller.publish(playing);
  assert.equal(calls[0].largeImage, "https://art.example.com/d/abc");
  assert.deepEqual(result.artwork, { strategy: "proxy", failure: "private_host" });
  assert.equal(controller.preview(playing).largeImage, FALLBACK_ARTWORK_URL);
});

test("keeps the configured asset on fallback or resolver failure", async () => {
  const calls = [];
  const client = { publish: async (activity) => { calls.push(activity); return true; } };
  const fallback = createDiscordController({ client, settings: { largeImage: "custom" }, artwork: { resolve: async () => ({ image: FALLBACK_ARTWORK_URL, strategy: "fallback", failure: "lookup_miss" }) } });
  assert.equal((await fallback.publish(playing)).activity.largeImage, "custom");
  const broken = createDiscordController({ client, artwork: { resolve: async () => { throw new Error("http://10.0.0.2 refused"); } } });
  const result = await broken.publish(playing);
  assert.equal(result.activity.largeImage, FALLBACK_ARTWORK_URL);
  assert.deepEqual(result.artwork, { strategy: "fallback", failure: "resolver_error" });
  assert.doesNotMatch(JSON.stringify(result), /10\.0\.0\.2/);
});

test("does not resolve artwork when the activity is cleared", async () => {
  let resolved = 0;
  const controller = createDiscordController({
    client: { publish: async () => true },
    artwork: { resolve: async () => { resolved += 1; return { image: "https://a.example.com/x", strategy: "provider" }; } },
  });
  const result = await controller.publish({ state: "idle", kind: "track", updatedAt: "2026-09-22T12:00:30.000Z" });
  assert.equal(result.activity, null);
  assert.equal(resolved, 0);
  assert.throws(() => createDiscordController({ client: { publish: async () => true }, artwork: {} }), /artwork.resolve is required/);
});
