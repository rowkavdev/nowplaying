import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { advanceSetupDraft, createSetupDraft, serializeSetupDraft } from "../src/setup.js";
import { createSetupDraftStore } from "../src/setup-draft-store.js";

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "np-draft-"));
  return createSetupDraftStore({ file: join(dir, "setup", "draft.json") });
}

test("starts fresh when no draft exists", async () => {
  const drafts = await store();
  const loaded = await drafts.load();
  assert.deepEqual(loaded, { draft: createSetupDraft(), resumed: false, discarded: false });
});

test("resumes non-secret progress after the wizard closes", async () => {
  const drafts = await store();
  const draft = advanceSetupDraft(advanceSetupDraft(createSetupDraft()), { provider: "jellyfin", discordIdleBehavior: "show" });
  await drafts.save(draft);
  const reopened = createSetupDraftStore({ file: drafts.file });
  const loaded = await reopened.load();
  assert.equal(loaded.resumed, true);
  assert.deepEqual(loaded.draft, draft);
  if (process.platform !== "win32") assert.equal((await stat(drafts.file)).mode & 0o777, 0o600);
});

test("never writes credentials into the draft file", async () => {
  const drafts = await store();
  await assert.rejects(drafts.save({ step: "provider", provider: "plex", token: "secret-token" }), /cannot contain credentials/);
  await assert.rejects(readFile(drafts.file), { code: "ENOENT" });
  await drafts.save({ step: "provider", provider: "plex" });
  assert.doesNotMatch(await readFile(drafts.file, "utf8"), /token|secret/i);
});

test("discards corrupt, tampered or unsupported drafts instead of failing setup", async () => {
  const drafts = await store();
  for (const body of ["{not json", JSON.stringify({ version: 2, step: "review" }), JSON.stringify({ version: 1, step: "review", token: "x" }), JSON.stringify({ version: 1, step: "hacked" }), "[]", "x".repeat(5000)]) {
    await drafts.save(createSetupDraft());
    await writeFile(drafts.file, body);
    const loaded = await drafts.load();
    assert.deepEqual(loaded, { draft: createSetupDraft(), resumed: false, discarded: true }, body.slice(0, 30));
    await assert.rejects(readFile(drafts.file), { code: "ENOENT" });
  }
});

test("clear removes the draft so a completed or cancelled setup starts over", async () => {
  const drafts = await store();
  await drafts.save({ step: "discord", provider: "emby" });
  await drafts.clear();
  assert.equal((await drafts.load()).resumed, false);
  assert.throws(() => createSetupDraftStore(), /file is required/);
});

function sizedDraft(bytes) {
  const make = n => createSetupDraft({ step: "signin", provider: "jellyfin",
    account: { provider: "jellyfin", id: "u1", displayName: "Test", serverUrl: `https://media.example/${"a".repeat(n)}` },
    servers: [{ provider: "emby", id: "u2", displayName: "Test", serverUrl: `https://other.example/${"b".repeat(1800)}` }] });
  return make(bytes - Buffer.byteLength(serializeSetupDraft(make(0))));
}

test("every accepted draft size round-trips and one byte over is rejected without deleting the saved draft", async () => {
  for (const bytes of [4095, 4096]) {
    const drafts = await store();
    const draft = sizedDraft(bytes);
    assert.equal(Buffer.byteLength(serializeSetupDraft(draft)), bytes);
    await drafts.save(draft);
    const loaded = await drafts.load();
    assert.equal(loaded.discarded, false);
    assert.deepEqual(loaded.draft, draft);
    assert.deepEqual((await createSetupDraftStore({ file: drafts.file }).load()).draft, draft);
  }
  const drafts = await store();
  const saved = sizedDraft(4096);
  await drafts.save(saved);
  await assert.rejects(drafts.save(sizedDraft(4097)), /too large/);
  assert.deepEqual((await drafts.load()).draft, saved);
});

test("an oversized draft file is still discarded on load", async () => {
  const drafts = await store();
  await drafts.save(createSetupDraft());
  await writeFile(drafts.file, `${serializeSetupDraft(sizedDraft(4096))} \n`);
  assert.equal((await drafts.load()).discarded, true);
});
