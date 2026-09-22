import test from "node:test";
import assert from "node:assert/strict";
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
    type: "watching",
    details: "Playing Example track",
    state: "by Example artist",
    largeImage: "media",
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
