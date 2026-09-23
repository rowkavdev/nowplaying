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
  for (const tag of body.match(/<script\b[^>]*>/g)) assert.match(tag, /src="\/setup\/app\.js"/);
  assert.doesNotMatch(body, /<script>[^<]/);
  assert.doesNotMatch(body, /\son[a-z]+=|\sstyle=|<style/i);
  assert.doesNotMatch(body, /https?:\/\//);
  const js = (await handle({ method: "GET", url: "/setup/app.js" })).body;
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /token|password|apiKey/i);
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
