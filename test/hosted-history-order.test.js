import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

for (const signedIn of [false, true]) {
  test(`a delayed ${signedIn ? "user" : "anonymous"} ingest response cannot replace newer last-played history`, async () => {
    let clock = 1_800_000_000_000;
    const now = () => clock;
    const redis = createMemoryRedis({ now });
    const committed = deferred();
    const resume = deferred();
    const original = redis.command.bind(redis);
    let delayed = false;
    redis.command = async (args) => {
      const result = await original(args);
      if (!delayed && args[0] === "EVAL" && String(args[1]).includes("local previous = tonumber")) {
        delayed = true;
        committed.resolve();
        await resume.promise;
      }
      return result;
    };
    const service = createService({ redis, now, githubUser: async () => ({ id: 101, login: "octo" }) });
    const device = signedIn
      ? await service.signInWithGitHub({ githubToken: "gho_test000000000" })
      : await service.register();
    const payload = (seq, title, state = "playing") => ({ v: 1, seq, observedAt: now(), state, kind: "track", title });
    const older = service.ingest({ token: device.token, payload: payload(1, "Old Song") });
    await committed.promise;
    clock += 1;
    await service.ingest({ token: device.token, payload: payload(2, "New Song") });
    resume.resolve();
    await older;
    await service.ingest({ token: device.token, payload: payload(3, null, "idle") });
    const badge = await service.readBadgeState({ ...(signedIn ? { login: device.login } : { id: device.cardId }), last: true });
    assert.equal(badge.title, "New Song");
  });
}

test("an idle update racing an accepted playing response still remembers that playback", async () => {
  const now = () => 1_800_000_000_000;
  const redis = createMemoryRedis({ now });
  const committed = deferred();
  const resume = deferred();
  const original = redis.command.bind(redis);
  let delayed = false;
  redis.command = async (args) => {
    const result = await original(args);
    if (!delayed && args[0] === "EVAL" && String(args[1]).includes("local previous = tonumber")) {
      delayed = true;
      committed.resolve();
      await resume.promise;
    }
    return result;
  };
  const service = createService({ redis, now });
  const { token, cardId } = await service.register();
  const playing = service.ingest({ token, payload: { v: 1, seq: 1, observedAt: now(), state: "playing", kind: "track", title: "Song" } });
  await committed.promise;
  await service.ingest({ token, payload: { v: 1, seq: 2, observedAt: now(), state: "idle" } });
  resume.resolve();
  await playing;
  assert.equal((await service.readBadgeState({ id: cardId, last: true })).title, "Song");
});

test("an earlier observation from another PC cannot overwrite newer last-played history", async () => {
  let clock = 1_800_000_000_000;
  const now = () => clock;
  const redis = createMemoryRedis({ now });
  const reached = deferred();
  const resume = deferred();
  const original = redis.command.bind(redis);
  let delayed = false;
  redis.command = async (args) => {
    if (!delayed && args[0] === "EVAL" && String(args[1]).includes("local previous = tonumber")) {
      delayed = true;
      reached.resolve();
      await resume.promise;
    }
    return original(args);
  };
  const service = createService({ redis, now, githubUser: async () => ({ id: 101, login: "octo" }) });
  const oldPc = await service.signInWithGitHub({ githubToken: "gho_test000000000" });
  const newPc = await service.signInWithGitHub({ githubToken: "gho_test000000000" });
  const payload = (title, state = "playing") => ({ v: 1, seq: 1, observedAt: now(), state, kind: "track", title });
  const older = service.ingest({ token: oldPc.token, payload: payload("Old Song") });
  await reached.promise;
  clock += 1;
  await service.ingest({ token: newPc.token, payload: payload("New Song") });
  resume.resolve();
  await older;
  for (const pc of [oldPc, newPc]) await service.ingest({ token: pc.token, payload: { ...payload(null, "idle"), seq: 2 } });
  assert.equal((await service.readBadgeState({ login: "octo", last: true })).title, "New Song");
});
