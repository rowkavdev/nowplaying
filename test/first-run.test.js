import test from "node:test";
import assert from "node:assert/strict";
import { ensureConfigured, parseStartArgs } from "../src/first-run.js";

test("an existing config starts straight away without opening setup", async () => {
  let opened = 0;
  assert.equal(await ensureConfigured({ configExists: async () => true, runSetup: async () => { opened += 1; return true; } }), "configured");
  assert.equal(opened, 0);
});

test("with no config, setup opens and start carries on once it writes one", async () => {
  let exists = false;
  const outcome = await ensureConfigured({ configExists: () => exists, runSetup: async () => { exists = true; return true; } });
  assert.equal(outcome, "setup-finished");
});

test("closing setup before Finish is reported as cancelled", async () => {
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => true }), "setup-cancelled");
});

test("a setup window that can't be shown (or throws) is reported as unavailable", async () => {
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => false }), "setup-unavailable");
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => { throw new Error("no powershell"); } }), "setup-unavailable");
  await assert.rejects(ensureConfigured({}), /required/);
});

test("parses start arguments", () => {
  assert.deepEqual(parseStartArgs([]), { module: null, setup: true });
  assert.deepEqual(parseStartArgs(["--no-setup"]), { module: null, setup: false });
  assert.deepEqual(parseStartArgs(["my.config.mjs"]), { module: "my.config.mjs", setup: true });
  assert.throws(() => parseStartArgs(["--nope"]), /unknown start option: --nope/);
  assert.throws(() => parseStartArgs(["a.mjs", "b.mjs"]), /at most one/);
});
