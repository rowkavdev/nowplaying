import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_ARTWORK_URL } from "../src/discord-artwork.js";
import { createPresence } from "../src/presence.js";
import { createDiscordConvergence, reconnectDelay } from "../src/discord-convergence.js";

const at = Date.parse("2026-09-23T01:30:00.000Z");
const playing = (title = "Track A") => createPresence({ state: "playing", kind: "track", title, updatedAt: new Date(at) });

test("connects, publishes transitions, clears idle and deduplicates unchanged activity", async () => {
  const calls = [];
  const client = { connect: async () => calls.push("connect"), publish: async (value) => calls.push(value) };
  const controller = createDiscordConvergence({ client, now: () => at });
  assert.equal(controller.status().state, "disconnected");
  assert.equal((await controller.reconcile(playing())).changed, false);
  assert.equal((await controller.connect()).state, "ready");
  assert.equal((await controller.reconcile(playing())).changed, true);
  assert.equal((await controller.reconcile(playing())).changed, false);
  assert.equal((await controller.reconcile(createPresence({ state: "idle", updatedAt: new Date(at) }))).changed, true);
  assert.deepEqual(calls, ["connect", { type: "listening", details: "Track A", largeImage: FALLBACK_ARTWORK_URL, largeText: "Playing" }, null]);
  assert.equal(controller.status().lastPublishedAt, "2026-09-23T01:30:00.000Z");
});

test("republishes latest activity after Discord restarts", async () => {
  const calls = [];
  const client = { connect: async () => {}, publish: async (value) => calls.push(value.details) };
  const controller = createDiscordConvergence({ client, now: () => at });
  await controller.connect();
  await controller.reconcile(playing());
  controller.disconnect();
  await controller.connect();
  await controller.reconcile(playing());
  assert.deepEqual(calls, ["Track A", "Track A"]);
});

test("uses bounded backoff and privacy-safe failure status", async () => {
  const secret = new Error("token secret at private.example");
  secret.code = "ECONNREFUSED";
  const controller = createDiscordConvergence({ client: { connect: async () => { throw secret; }, publish: async () => {} } });
  const status = await controller.connect();
  assert.deepEqual(status.lastError, { code: "ECONNREFUSED" });
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.equal(controller.nextReconnectDelay(), 2_000);
  assert.equal(reconnectDelay(20), 30_000);
});

test("degrades after publish failure and retries the latest state after reconnect", async () => {
  let fail = true;
  const calls = [];
  const client = { connect: async () => {}, publish: async (value) => { if (fail) { fail = false; throw new Error("private title"); } calls.push(value.details); } };
  const controller = createDiscordConvergence({ client, now: () => at });
  await controller.connect();
  assert.equal((await controller.reconcile(playing())).status.state, "degraded");
  await controller.connect();
  assert.equal((await controller.reconcile(playing())).changed, true);
  assert.deepEqual(calls, ["Track A"]);
});
