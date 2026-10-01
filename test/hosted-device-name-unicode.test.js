import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";

test("a long device name is cut on a character boundary, never inside an emoji", async () => {
  let clock = 1_800_000_000_000;
  const now = () => clock;
  const githubUser = async () => ({ id: 101, login: "RowKav" });
  const service = createService({ redis: createMemoryRedis({ now }), now, githubUser });
  const name = "a".repeat(39) + "\u{1F3B5}\u{1F3B5}";
  const signed = await service.signInWithGitHub({ githubToken: "gho_rowan00000000", deviceName: name, clientKey: "k" });
  const { devices } = await service.listDevices({ token: signed.token });
  const stored = devices[0].name;
  assert.ok(stored.length <= 40);
  assert.ok(!/[\uD800-\uDBFF]$/.test(stored), "device name must not end in a lone surrogate");
});
