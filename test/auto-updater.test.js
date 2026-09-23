import test from "node:test";
import assert from "node:assert/strict";
import { createAutoUpdater } from "../src/auto-updater.js";

const noRelease = async () => ({ ok: true, json: async () => [] });

test("supports off and notify policies without installing", async () => {
  assert.deepEqual(await createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", mode: "off" }).check(), { status: "disabled" });
  const updater = createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", mode: "notify", channel: "stable", fetchImpl: noRelease });
  assert.deepEqual(await updater.check(), { status: "current", version: "0.1.0" });
});

test("deduplicates concurrent checks", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => { calls += 1; await gate; return { ok: true, json: async () => [] }; };
  const updater = createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", channel: "beta", fetchImpl });
  const first = updater.check();
  const second = updater.check();
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ status: "current", version: "0.1.0" }, { status: "current", version: "0.1.0" }]);
  assert.equal(calls, 1);
});

test("the update channel is never picked for the user (#172)", () => {
  assert.throws(() => createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y" }), /choose stable or beta/);
  assert.throws(() => createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", mode: "install" }), /choose stable or beta/);
  assert.throws(() => createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", mode: "off", channel: "nightly" }), /expected stable or beta/);
  assert.equal(createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", mode: "off" }).channel, undefined);
  assert.equal(createAutoUpdater({ currentVersion: "0.1.0", repository: "x/y", channel: "stable" }).channel, "stable");
});
