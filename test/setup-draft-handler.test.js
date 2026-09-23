import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSetupDraftStore } from "../src/setup-draft-store.js";
import { createSetupDraftHandler } from "../src/setup-draft-handler.js";
import { createHttpServer } from "../src/http-server.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "np-draft-api-"));
  const store = createSetupDraftStore({ file: join(dir, "draft.json") });
  return { store, handle: createSetupDraftHandler({ store }) };
}
const post = (body) => ({ method: "POST", url: "/api/setup/draft", body: JSON.stringify(body) });
const parse = (response) => JSON.parse(response.body);

test("walks the wizard forward and back, persisting each step", async () => {
  const { store, handle } = await setup();
  const first = await handle({ method: "GET", url: "/api/setup/draft" });
  assert.equal(first.status, 200);
  assert.equal(first.headers["Cache-Control"], "no-store");
  assert.deepEqual(parse(first), { draft: { version: 1, step: "welcome", provider: null, discordEnabled: true, discordIdleBehavior: "clear" }, resumed: false, discarded: false });

  assert.equal(parse(await handle(post({ action: "next" }))).draft.step, "provider");
  const discord = parse(await handle(post({ action: "next", changes: { provider: "navidrome" } }))).draft;
  assert.deepEqual([discord.step, discord.provider], ["discord", "navidrome"]);
  assert.equal(parse(await handle(post({ action: "back" }))).draft.step, "provider");

  const reopened = await createSetupDraftHandler({ store })({ method: "GET", url: "/api/setup/draft" });
  assert.deepEqual([parse(reopened).resumed, parse(reopened).draft.provider], [true, "navidrome"]);
});

test("rejects credentials and unknown fields without echoing them", async () => {
  const { store, handle } = await setup();
  for (const body of [{ action: "save", changes: { token: "s3cret" } }, { action: "save", changes: { provider: "evil" } }, { action: "save", token: "s3cret" }, { action: "jump" }, [1]]) {
    const response = await handle(post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.doesNotMatch(response.body, /s3cret|evil/);
  }
  assert.equal((await handle({ method: "POST", url: "/api/setup/draft", body: "{nope" })).status, 400);
  await assert.rejects(readFile(store.file), { code: "ENOENT" });
});

test("reset clears progress; other methods and paths are refused", async () => {
  const { handle } = await setup();
  await handle(post({ action: "next" }));
  const reset = await handle({ method: "DELETE", url: "/api/setup/draft" });
  assert.equal(parse(reset).draft.step, "welcome");
  assert.equal(parse(await handle({ method: "GET", url: "/api/setup/draft" })).resumed, false);
  const put = await handle({ method: "PUT", url: "/api/setup/draft", body: "{}" });
  assert.deepEqual([put.status, put.headers.Allow], [405, "GET, POST, DELETE"]);
  assert.equal(await handle({ method: "GET", url: "/api/other" }), null);
  assert.equal((await handle({ method: "GET", url: "/api/setup/draft?x=1" })).status, 400);
  assert.throws(() => createSetupDraftHandler({ store: {} }), /store is invalid/);
});

test("works behind the loopback server and refuses cross-site writes", async () => {
  const { handle } = await setup();
  const app = createHttpServer({ handler: handle, port: 0 });
  const { port } = await app.listen();
  const base = `http://127.0.0.1:${port}/api/setup/draft`;
  try {
    const ok = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "next" }) });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal((await ok.json()).draft.step, "provider");
    const evil = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ action: "next" }) });
    assert.equal(evil.status, 403);
    const form = await fetch(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "next" }) });
    assert.equal(form.status, 415);
    assert.equal((await (await fetch(base)).json()).draft.step, "provider");
  } finally {
    await app.close();
  }
});
