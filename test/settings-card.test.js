import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyCardChanges, cardSettingsView } from "../src/app-settings.js";
import { parseAppConfig, startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };
const DEFAULTS = { theme: "midnight-blue", width: 440, padding: 24, radius: 10, progressHeight: 4, showProgress: true, artworkPosition: "left", artworkWidth: 68, artworkHeight: 100, fieldOrder: ["state", "title", "subtitle"], textAlign: "start", progressPosition: "bottom", progressWidth: "content", direction: "ltr", artworkTint: true };

test("the card view shows renderer defaults for configs without a card section", () => {
  assert.deepEqual({ ...cardSettingsView(parseAppConfig(serializeSetupConfig(BASE))) }, DEFAULTS);
  const compact = parseAppConfig(serializeSetupConfig({ ...BASE, card: { theme: "compact" } }));
  assert.equal(cardSettingsView(compact).showProgress, false);
});

test("card changes are saved in full and bad ones are refused", () => {
  const before = parseAppConfig(serializeSetupConfig(BASE));
  const { config } = applyCardChanges(before, { theme: "paper", radius: 0 });
  assert.deepEqual({ ...config.card }, { ...DEFAULTS, theme: "paper", radius: 0 });
  assert.deepEqual({ ...config.discord }, { ...before.discord });
  for (const bad of [{}, { colors: {} }, { radius: 99 }, { theme: "neon" }, { showProgress: 1 }, { artworkTint: "no" }]) assert.throws(() => applyCardChanges(before, bad), TypeError, JSON.stringify(bad));
});

function handler(previewCard = async (card) => `<svg data-card='${JSON.stringify(card)}'></svg>`) {
  let card = { ...DEFAULTS };
  const settings = { read: () => ({ discord: {}, card }), updateDiscord: async () => {}, updateCard: async (changes) => { card = { ...card, ...changes }; }, previewCard };
  return createSettingsPageHandler({ settings, fallback: async () => ({ status: 299 }) });
}
const PREVIEW = "/api/settings/card/preview.svg";

test("the settings API reads and saves the card section", async () => {
  const h = handler();
  assert.deepEqual(JSON.parse((await h({ url: "/api/settings" })).body).card, DEFAULTS);
  const saved = await h({ method: "PUT", url: "/api/settings", body: JSON.stringify({ card: { theme: "paper" } }) });
  assert.equal(JSON.parse(saved.body).card.theme, "paper");
});

test("the preview renders draft settings and refuses bad ones", async () => {
  const h = handler();
  const ok = await h({ url: `${PREVIEW}?theme=paper&width=500&padding=16&radius=0&progressHeight=8&showProgress=0` });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["Content-Type"], "image/svg+xml; charset=utf-8");
  assert.equal(ok.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(ok.body.match(/data-card='(.*)'/)[1]), { theme: "paper", width: 500, padding: 16, radius: 0, progressHeight: 8, showProgress: false });
  const art = await h({ url: `${PREVIEW}?artworkPosition=right&artworkWidth=120&artworkHeight=90` });
  assert.deepEqual(JSON.parse(art.body.match(/data-card='(.*)'/)[1]), { artworkPosition: "right", artworkWidth: 120, artworkHeight: 90 });
  const text = await h({ url: `${PREVIEW}?fieldOrder=title,subtitle,state&textAlign=middle` });
  assert.deepEqual(JSON.parse(text.body.match(/data-card='(.*)'/)[1]), { fieldOrder: ["title", "subtitle", "state"], textAlign: "middle" });
  const bar = await h({ url: `${PREVIEW}?progressPosition=text&progressWidth=full` });
  assert.deepEqual(JSON.parse(bar.body.match(/data-card='(.*)'/)[1]), { progressPosition: "text", progressWidth: "full" });
  const dir = await h({ url: `${PREVIEW}?direction=auto` });
  assert.deepEqual(JSON.parse(dir.body.match(/data-card='(.*)'/)[1]), { direction: "auto" });
  for (const query of ["direction=RTL", "progressPosition=top", "progressWidth=half", "fieldOrder=title,title,state", "fieldOrder=title", "textAlign=center", "artworkPosition=top", "artworkWidth=40", "artworkHeight=200",
    "theme=neon", "width=9999", "radius=-1", "radius=1.5", "showProgress=yes", "colors=red", "theme=paper&theme=paper"]) {
    assert.equal((await h({ url: `${PREVIEW}?${query}` })).status, 400, query);
  }
  assert.equal((await h({ method: "POST", url: PREVIEW })).status, 405);
  assert.equal((await h({ url: PREVIEW, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  const broken = handler(async () => { throw new Error("C:\\\\secret"); });
  const failed = await broken({ url: PREVIEW });
  assert.deepEqual([failed.status, failed.body], [503, "Preview unavailable"]);
});

test("the running app applies a card save to /card.svg without a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-card-settings-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ ...BASE, discordEnabled: false }));
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" } });
  try {
    const page = await fetch(`${app.url}/settings`);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    assert.match(await (await fetch(`${app.url}/card.svg`)).text(), /#0d1117/);
    const saved = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ card: { theme: "paper", width: 520 } }) });
    assert.equal(saved.status, 200);
    assert.equal(parseAppConfig(await readFile(file, "utf8")).card.theme, "paper");
    const card = await (await fetch(`${app.url}/card.svg`)).text();
    assert.match(card, /#ffffff/);
    assert.match(card, /width="520"/);
    // Preview of a draft (nothing playing, so a sample track) doesn't save it.
    const preview = await fetch(`${app.url}/api/settings/card/preview.svg?theme=midnight-blue&radius=0`);
    assert.equal(preview.status, 200);
    const svg = await preview.text();
    assert.match(svg, /Sample track/);
    assert.match(svg, /#0d1117/);
    assert.equal(parseAppConfig(await readFile(file, "utf8")).card.theme, "paper");
    // The preview draws a placeholder so artwork placement is visible.
    const right = await (await fetch(`${app.url}/api/settings/card/preview.svg?width=440&padding=24&artworkPosition=right&artworkWidth=100&artworkHeight=100`)).text();
    assert.match(right, /<image href="data:image\/png;base64,[^"]+" x="316" y="24" width="100" height="100"/);
    const artSaved = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ card: { artworkPosition: "right", artworkWidth: 100 } }) });
    assert.equal(artSaved.status, 200);
    const onDisk = parseAppConfig(await readFile(file, "utf8")).card;
    assert.deepEqual([onDisk.artworkPosition, onDisk.artworkWidth, onDisk.theme], ["right", 100, "paper"]);
  } finally {
    await app.close();
  }
});

test("the page has a Card section with a live preview and no inline script or style", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  for (const id of ["card-theme", "card-width", "card-padding", "card-radius", "card-showProgress", "card-progressHeight", "card-artworkPosition", "card-artworkWidth", "card-artworkHeight", "card-fieldOrder", "card-textAlign", "card-progressPosition", "card-progressWidth", "card-direction", "card-preview", "card-save", "card-reset"]) assert.match(page, new RegExp(`id="${id}"`), id);
  for (const value of ["midnight-blue", "paper", "compact"]) assert.match(page, new RegExp(`<option value="${value}">`));
  assert.match(page, /<input type="number" id="card-width" min="280" max="800"/);
  assert.equal(page.match(/<option value="(?:state|title|subtitle),(?:state|title|subtitle),(?:state|title|subtitle)">/g).length, 6);
  assert.equal(page.toLowerCase().split("<script").length, 2);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=/i);
  const script = (await h({ url: "/settings.js" })).body;
  assert.match(script, /\/api\/settings\/card\/preview\.svg\?/);
  assert.match(script, /send\("\/api\/settings", "PUT", \{ card: values \}\)/);
  assert.doesNotThrow(() => new Function(script));
  // State colours stay blue/orange: no red or green in the page styles.
  const css = (await h({ url: "/settings.css" })).body;
  assert.doesNotMatch(css, /#(?:f00|ff0000|0f0|00ff00|d73a49|28a745|2da44e|cf222e)\b/i);
});

test("the hosted link follows the saved card style, width and progress bar", async () => {
  const script = (await handler()({ url: "/settings.js" })).body;
  const hostedLink = new Function("savedCard", script.match(/function hostedLink\(base\) \{[\s\S]*?\n\}/)[0] + "; return hostedLink;");
  const base = "https://nowplaying-hosted.vercel.app/card/abc.svg";
  assert.equal(hostedLink(null)(base), base);
  assert.equal(hostedLink(DEFAULTS)(base), base);
  assert.equal(hostedLink({ ...DEFAULTS, theme: "paper", width: 520, showProgress: false })(base), `${base}?theme=paper&width=520&show=mediaType,state,subtitle`);
  assert.equal(hostedLink({ ...DEFAULTS, theme: "compact", showProgress: false })(base), `${base}?theme=compact`);
  assert.equal(hostedLink({ ...DEFAULTS, radius: 0, padding: 12 })(base), `${base}?padding=12&radius=0`);
  assert.equal(hostedLink({ ...DEFAULTS, artworkPosition: "right", artworkWidth: 120, artworkHeight: 120 })(base), base, "artwork settings stay local");
  assert.equal(hostedLink({ ...DEFAULTS, progressHeight: 8, fieldOrder: ["title", "subtitle", "state"], textAlign: "middle", progressPosition: "text", progressWidth: "full", direction: "auto" })(base),
    `${base}?progressHeight=8&fieldOrder=title,subtitle,state&textAlign=middle&progressPosition=text&progressWidth=full&direction=auto`);
  assert.equal(hostedLink({ ...DEFAULTS, showProgress: false, progressHeight: 8, progressPosition: "text", progressWidth: "full" })(base), `${base}?show=mediaType,state,subtitle`, "bar options drop when the bar is off");
  assert.equal(hostedLink(DEFAULTS)(""), "");
});
