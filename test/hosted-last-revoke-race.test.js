import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("revoking a card while ingest is paused after its atomic commit cannot resurrect last-played history", async () => {
  const now = () => 1_800_000_000_000;
  const redis = createMemoryRedis({ now });
  const committed = deferred();
  const resume = deferred();
  const original = redis.command.bind(redis);
  redis.command = async (args) => {
    const result = await original(args);
    if (args[0] === "EVAL" && String(args[1]).includes("local previous = tonumber")) {
      committed.resolve();
      await resume.promise;
    }
    return result;
  };
  const service = createService({ redis, now });
  const { cardId, token } = await service.register();
  const ingest = service.ingest({ token, payload: { v: 1, seq: 1, observedAt: now(), state: "playing", kind: "track", title: "Private Song" } });
  await committed.promise;
  await service.revoke({ token });
  resume.resolve();
  await ingest;
  assert.equal((await service.readBadgeState({ id: cardId, last: true })).title, null);
  assert.equal(redis.data.has(`np:last:card:${cardId}:track`), false);
});

test("a history write completed before revoke is deleted and normal ingest still remembers playback", async () => {
  const now = () => 1_800_000_000_000;
  const redis = createMemoryRedis({ now });
  const service = createService({ redis, now });
  const { cardId, token } = await service.register();
  await service.ingest({ token, payload: { v: 1, seq: 1, observedAt: now(), state: "playing", kind: "track", title: "Song" } });
  assert.equal((await service.readBadgeState({ id: cardId, last: true })).title, "Song");
  await service.revoke({ token });
  assert.equal((await service.readBadgeState({ id: cardId, last: true })).title, null);
  assert.equal(redis.data.has(`np:last:card:${cardId}:track`), false);
});
