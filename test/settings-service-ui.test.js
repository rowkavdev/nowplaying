import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { SERVICE_SCRIPT } from "../src/settings-onboarding-page.js";

const reply = (body, ok = true) => ({ ok, json: async () => body });
const pending = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function page() {
  const elements = new Map();
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, textContent: "", children: [],
      addEventListener(event, fn) { this[event] = fn; }, replaceChildren(...children) { this.children = children; } });
    return elements.get(id);
  };
  const calls = [];
  runInNewContext(SERVICE_SCRIPT, {
    document: { getElementById: node, createElement: () => ({ href: "", textContent: "" }) },
    fetch: (path, options) => { const result = pending(); calls.push({ path, options, ...result }); return result.promise; },
    setTimeout: (fn) => { const timer = setTimeout(fn, 0); timer.unref(); return timer; },
    window: { open() {} }, confirm: () => true,
  });
  return { node, calls };
}

test("unexpected Spotify poll status is not treated as connected", async () => {
  const { node, calls } = page();
  calls[0].resolve(reply({ spotify: null, hosted: { login: null, url: "https://nowplaying-hosted.vercel.app" } })); await tick();
  node("spotify-client-id").value = "0123456789abcdef0123456789abcdef";
  const start = node("spotify-connect").click();
  calls[1].resolve(reply({ status: "pending", flowId: "flow-2", authUrl: "https://accounts.spotify.com/authorize" }));
  await tick();
  calls[2].resolve(reply({ status: "failed", error: "expired" })); await tick(); await start;
  assert.match(node("spotify-service-result").textContent, /failed|expired/i);
  assert.doesNotMatch(node("spotify-service-result").textContent, /Spotify connected/);
  assert.equal(node("spotify-open-link").hidden, true);
});

test("failed Spotify OAuth result never claims the account connected", async () => {
  const { node, calls } = page();
  calls[0].resolve(reply({ spotify: null, hosted: { login: null, url: "https://nowplaying-hosted.vercel.app" } })); await tick();
  node("spotify-client-id").value = "0123456789abcdef0123456789abcdef";
  const start = node("spotify-connect").click();
  calls[1].resolve(reply({ status: "started", flowId: "flow-1", authUrl: "https://accounts.spotify.com/authorize" }));
  await tick();
  calls[2].resolve(reply({ error: "denied" }, false)); await tick(); await start;
  assert.doesNotMatch(node("spotify-service-result").textContent, /Spotify connected/);
  assert.match(node("spotify-service-result").textContent, /denied|failed/i);
  assert.equal(node("spotify-open-link").hidden, true);
});

test('#818 stale Spotify poll cannot clear a replacement flow or overwrite its success', async () => {
  for (const newerFinishes of [false, true]) {
    const { node, calls } = page();
    calls[0].resolve(reply({ spotify: null, hosted: { login: null, url: 'https://cards.example' } })); await tick();
    node('spotify-client-id').value = '0123456789abcdef0123456789abcdef';
    node('spotify-connect').click(); calls[1].resolve(reply({ status: 'started', flowId: 'a', authUrl: 'https://accounts.spotify.com/a' })); await tick();
    const old = calls[2];
    node('spotify-connect').click(); calls[3].resolve(reply({ status: 'started', flowId: 'b', authUrl: 'https://accounts.spotify.com/b' })); await tick();
    if (newerFinishes) {
      calls[4].resolve(reply({ status: 'signed_in' })); await tick();
      calls[5].resolve(reply({ spotify: { name: 'Fixture', clientId: 'fixture' }, hosted: { login: null, url: 'https://cards.example' } })); await tick();
    }
    old.resolve(reply({ error: 'expired' }, false)); await tick();
    if (newerFinishes) assert.equal(node('spotify-service-result').textContent, 'Spotify connected.');
    else { assert.equal(node('spotify-open-link').hidden, false); assert.doesNotMatch(node('spotify-service-result').textContent, /failed/); }
  }
});
