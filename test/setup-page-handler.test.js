import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSetupPageHandler } from "../src/setup-page-handler.js";
import { createHttpServer, PAGE_CSP } from "../src/http-server.js";

const handle = createSetupPageHandler();

test("serves the wizard page and its same-origin assets", async () => {
  const page = await handle({ method: "GET", url: "/setup" });
  assert.equal(page.status, 200);
  assert.equal(page.page, true);
  assert.match(page.headers["Content-Type"], /^text\/html/);
  const js = await handle({ method: "GET", url: "/setup/app.js" });
  assert.match(js.headers["Content-Type"], /^text\/javascript/);
  assert.equal(js.page, undefined);
  assert.doesNotThrow(() => new Script(js.body));
  assert.match((await handle({ method: "GET", url: "/setup/app.css" })).headers["Content-Type"], /^text\/css/);
});

test("the page contains no inline script, handlers, styles or external references", async () => {
  const { body } = await handle({ method: "GET", url: "/setup" });
  for (const tag of body.match(/<script\b[^>]*>/gi)) assert.match(tag, /src="\/setup\/app\.js"/);
  assert.doesNotMatch(body, /<script\b[^>]*>[^<]/i);
  assert.doesNotMatch(body, /\son[a-z]+=|\sstyle=|<style/i);
  assert.doesNotMatch(body, /https?:\/\//);
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /token|apiKey|localStorage|sessionStorage|document\.cookie/i);
  // The password box is only read to send one sign-in request, then cleared.
  assert.match(js, /password\.value = ""/);
});

test("the sign-in step talks only to the local sign-in API and opens only Plex", async () => {
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.match(js, /"\/api\/setup\/signin"/);
  assert.match(js, /indexOf\("https:\/\/app\.plex\.tv\/"\) === 0/);
  assert.match(js, /needsSignIn = draft\.step === "signin" && !draft\.account/);
});

test("ignores other paths and refuses writes", async () => {
  assert.equal(await handle({ method: "GET", url: "/setup/../etc/passwd" }), null);
  assert.equal(await handle({ method: "GET", url: "/setupx" }), null);
  assert.equal(await handle({ method: "GET", url: "/setup/constructor" }), null);
  const post = await handle({ method: "POST", url: "/setup" });
  assert.deepEqual([post.status, post.headers.Allow], [405, "GET, HEAD"]);
  assert.equal((await handle({ method: "HEAD", url: "/setup" })).body, "");
});

test("the loopback server applies the page policy to the wizard only", async () => {
  const app = createHttpServer({ handler: handle, port: 0 });
  const { port } = await app.listen();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/setup`);
    assert.equal(page.headers.get("content-security-policy"), PAGE_CSP);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const js = await fetch(`http://127.0.0.1:${port}/setup/app.js`);
    assert.match(js.headers.get("content-security-policy"), /^default-src 'none'/);
    assert.equal(js.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally {
    await app.close();
  }
});

test("the page offers adding, cancelling and removing servers through the draft API (#252)", async () => {
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.match(js, /action: "add-server"/);
  assert.match(js, /action: "cancel-add-server"/);
  assert.match(js, /action: "remove-server", server: \{ provider: event\.target\.dataset\.provider, id: event\.target\.dataset\.id \}/);
  assert.doesNotMatch(js, /innerHTML/);
});

test("the page offers an optional Spotify sign-in and opens only Spotify's accounts site (#135)", async () => {
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.match(js, /"\/api\/setup\/spotify"/);
  assert.match(js, /indexOf\("https:\/\/accounts\.spotify\.com\/"\) === 0/);
  assert.match(js, /action: "clear-spotify"/);
  assert.match(js, /never on Discord/);
});

test("Emby and Navidrome sign-in shows provider help, the same in the browser and the native window (#141)", async () => {
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  const { readFile } = await import("node:fs/promises");
  const ps1 = await readFile(new URL("../scripts/windows-setup.ps1", import.meta.url), "utf8");
  for (const provider of ["emby", "navidrome"]) {
    const text = new RegExp(`${provider}: "([^"]+)"`).exec(js.slice(js.indexOf("SIGNIN_HELP")))?.[1];
    assert.ok(text, provider);
    assert.match(text, /not your password/);
    assert.ok(ps1.includes(`${provider} = '${text}'`), `${provider} wording matches the native window`);
  }
});

test("the card hosting step uses the hosted setup API and leaves room for GitHub sign-in (#140)", async () => {
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.match(js, /"\/api\/setup\/hosted\/"/);
  assert.match(js, /"hosting"/);
  assert.match(js, /id: "hostedSignIn"/);
  for (const choice of ["Not now", "NowPlaying's hosted service", "My own card service (self-hosted)"]) assert.ok(js.includes(choice), choice);
});
