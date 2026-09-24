// Automated accessibility checks for the local pages (0.2 QA, #141 "keyboard,
// screen reader, 200% scaling and deuteranopia" box). These can't replace a
// real screen reader pass, but they catch the regressions a person would
// notice first: unlabeled controls, zoom blocked, focus rings removed, and
// red/green used for state.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { createSetupPageHandler } from "../src/setup-page-handler.js";

async function startApp() {
  const dir = await mkdtemp(join(tmpdir(), "np-a11y-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true }));
  return startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" } });
}

async function pages() {
  const app = await startApp();
  try {
    const out = {};
    for (const path of ["/", "/settings", "/logs"]) {
      const html = await (await fetch(`${app.url}${path}`)).text();
      const css = [];
      for (const [, href] of html.matchAll(/href="([^"]+\.css)"/g)) css.push(await (await fetch(`${app.url}${href}`)).text());
      out[path] = { html, css: css.join("\n") };
    }
    const setup = createSetupPageHandler();
    out["/setup"] = { html: (await setup({ url: "/setup" })).body, css: (await setup({ url: "/setup/app.css" })).body };
    return out;
  } finally {
    await app.close();
  }
}

const all = pages();

test("a11y: every page declares a language and allows zoom", async () => {
  for (const [path, { html }] of Object.entries(await all)) {
    assert.match(html, /<html[^>]*\blang="[a-z]{2}/i, `${path}: <html lang> is missing`);
    const viewport = html.match(/<meta[^>]*name="viewport"[^>]*content="([^"]*)"/i)?.[1] ?? "";
    assert.ok(viewport, `${path}: viewport meta is missing`);
    assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0*)?\b/i, `${path}: zoom is blocked`);
  }
});

test("a11y: no page removes the keyboard focus ring without a replacement", async () => {
  // Browser default focus rings are fine; the regression to catch is CSS that
  // hides them (outline: none/0) without a visible stand-in in the same rule.
  for (const [path, { css }] of Object.entries(await all)) {
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/outline\s*:\s*(none|0)\b/.test(body)) continue;
      assert.match(body, /box-shadow|border(-color)?\s*:/, `${path}: "${selector.trim()}" removes the focus outline with nothing in its place`);
    }
  }
  assert.match((await all)["/setup"].css, /:focus-visible\s*\{[^}]*outline\s*:\s*\d+px solid/, "setup keeps its strong focus ring");
});

test("a11y: form controls on the settings page have accessible names", async () => {
  const { html } = (await all)["/settings"];
  const labelled = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  const problems = [];
  for (const [tag] of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    if (/type="(hidden|submit|button|reset)"/.test(tag)) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const named = /aria-label(ledby)?="[^"]+"/.test(tag) || /\btitle="[^"]+"/.test(tag) || (id && labelled.has(id));
    // A control wrapped inside its <label> is named too.
    const wrapped = id ? new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*id="${id}"`).test(html) : false;
    if (!named && !wrapped) problems.push(tag);
  }
  assert.deepEqual(problems, [], "controls without a label or aria-label");
  for (const [, inner] of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    assert.ok(inner.replace(/<[^>]+>/g, "").trim() || /aria-label=/.test(inner), "a button has no text");
  }
});

// Deuteranopia-safe palette (project rule: blue/orange for state, never
// red/green). Flags saturated colours whose hue is red or green.
function hues(css) {
  const out = [];
  for (const [raw, hex] of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    out.push({ raw, r, g, b });
  }
  for (const [raw, r, g, b] of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) out.push({ raw, r: r / 255, g: g / 255, b: b / 255 });
  return out.map(({ raw, r, g, b }) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { raw, hue: (h * 60 + 360) % 360, sat: s, val: max };
  });
}

test("a11y: page CSS uses no saturated red or green (deuteranopia-safe)", async () => {
  for (const [path, { css }] of Object.entries(await all)) {
    const bad = hues(css).filter(({ hue, sat, val }) => sat > 0.45 && val > 0.35 && (hue < 12 || hue > 345 || (hue > 85 && hue < 160)));
    assert.deepEqual(bad.map((c) => c.raw), [], `${path}: red/green colours in CSS`);
  }
});
