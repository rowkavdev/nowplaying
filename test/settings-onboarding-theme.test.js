import test from "node:test";
import assert from "node:assert/strict";
import { createFirstRunSettingsHandler, createSettingsPageHandler } from "../src/settings-page-handler.js";

const handler = () => createFirstRunSettingsHandler({ servers: async () => ({ status: 299 }) });
const luminance = hex => {
  const [r, g, b] = hex.slice(1).match(/../g).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

test("first-run setup loads its scoped theme and serves it as an external stylesheet", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /<html lang="en" class="onboarding-root">/);
  assert.match(page, /<body class="onboarding-shell">/);
  assert.match(page, /<link rel="stylesheet" href="\/onboarding.css">/);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=/i);
  const asset = await h({ url: "/onboarding.css" });
  assert.equal(asset.headers["Content-Type"], "text/css; charset=utf-8");
  assert.match(asset.body, /\.onboarding-shell a,\.onboarding-shell a:visited\{color:var\(--setup-link\);text-decoration:underline/);
  assert.match(asset.body, /\.onboarding-shell :focus-visible\{outline:3px solid var\(--setup-focus\)/);
  assert.match(asset.body, /\.onboarding-shell input::placeholder\{color:var\(--setup-muted\);opacity:1\}/);
  assert.equal((await h({ method: "HEAD", url: "/onboarding.css" })).body, "");
  assert.equal((await h({ method: "POST", url: "/onboarding.css" })).status, 405);
});

test("setup sign-in links, labels, hints and controls have sufficient contrast in both themes", async () => {
  const css = (await handler()({ url: "/onboarding.css" })).body;
  const palettes = [...css.matchAll(/body\.onboarding-shell\{([^}]+)\}/g)].map(([, body]) => Object.fromEntries([...body.matchAll(/--setup-([a-z]+):(#[0-9a-f]{6})/g)].map(([, name, value]) => [name, value])));
  assert.equal(palettes.length, 2, "separate light and dark palettes");
  for (const palette of palettes) {
    for (const background of [palette.bg, palette.surface, palette.control]) {
      for (const foreground of [palette.text, palette.muted, palette.link]) assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
      for (const foreground of [palette.border, palette.focus, palette.error]) assert.ok(contrast(foreground, background) >= 3, `${foreground} on ${background}`);
    }
  }
  assert.match(css, /html\.onboarding-root\{color-scheme:light\}/);
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{html\.onboarding-root\{color-scheme:dark\}/);
});

test("configured Settings keeps its existing dark shell and does not load the setup palette", async () => {
  const h = createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /<body class="drpp-shell">/);
  assert.doesNotMatch(page, /onboarding\.css|onboarding-shell/);
  assert.equal((await h({ url: "/onboarding.css" })).status, 299);
});
