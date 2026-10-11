import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cardPresets, renderCard } from "../src/card.js";
import { createSettings } from "../src/settings.js";
import { cardSettingsView } from "../src/app-settings.js";
import { serializeSetupConfig, normalizeCard, cardRenderOptions } from "../src/setup-config.js";
import { startAppFromConfig } from "../src/app-config.js";
import { parseCardOptions } from "../hosted/lib/http.js";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const presence = { state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", positionMs: 83_000, durationMs: 448_000 };
const base = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "preview", displayName: "Preview library" }, credentialStored: true, discordEnabled: false };
const optionsForView = view => cardRenderOptions(normalizeCard(Object.fromEntries(Object.entries(view).filter(([, value]) => value !== null))));
const handler = () => createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => ({ status: 404 }) });

test("new styles differ in typography and shape, with explicit layout taking precedence", () => {
  const editorial = renderCard(presence, { theme: "editorial" });
  assert.match(editorial, /ui-serif,Georgia/);
  assert.match(editorial, /rx="0"/);
  assert.match(editorial, /font-size="24"/);
  const terminal = renderCard(presence, { theme: "terminal" });
  assert.match(terminal, /ui-monospace/);
  assert.match(terminal, />NOW PLAYING</);
  assert.match(renderCard(presence, { theme: "studio" }), /r="3.5"/);
  const customized = renderCard(presence, { theme: "editorial", layout: { radius: 8, fontFamily: "mono", titleSize: 16 } });
  assert.match(customized, /rx="8"/);
  assert.match(customized, /ui-monospace/);
  assert.match(customized, /font-size="16"/);
  for (const theme of Object.keys(cardPresets)) {
    const direct = renderCard(presence, { theme, width: 440 });
    const view = cardSettingsView({ card: { theme } });
    assert.equal(renderCard(presence, optionsForView(view)), direct, `${theme} Settings defaults match the renderer`);
    const settings = createSettings({ card: { theme, width: 440 } });
    assert.equal(renderCard(presence, settings.card), direct, `${theme} library defaults match the renderer`);
  }
});

test("gallery thumbnails use allowlisted SVG routes and do not embed playback from the user", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  assert.equal((page.match(/data-card-theme=/g) ?? []).length, 6);
  assert.match(page, /class="card-advanced"/);
  for (const theme of Object.keys(cardPresets)) {
    const asset = await h({ url: `/card-styles/${theme}.svg` });
    assert.equal(asset.status, 200);
    assert.match(asset.headers["Content-Type"], /image\/svg\+xml/);
    assert.match(asset.body, /Blue Monday/);
    assert.equal((await h({ method: "HEAD", url: `/card-styles/${theme}.svg` })).body, "");
    assert.equal((await h({ method: "POST", url: `/card-styles/${theme}.svg` })).status, 405);
  }
  assert.equal((await h({ url: "/card-styles/unknown.svg" })).status, 404);
});

test("preview, saved local card and copied hosted link agree for each style and custom overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-style-flow-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig(base));
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "fixture-token" }, port: 0, fetchImpl: async () => Response.json([{ UserId: "preview", NowPlayingItem: { Type: "Audio", Name: presence.title, Artists: [presence.subtitle], RunTimeTicks: presence.durationMs * 10_000 }, PlayState: { PositionTicks: presence.positionMs * 10_000 } }]), discord: { env: {}, builtInClientId: "" } });
  try {
    const page = await fetch(`${app.url}/settings`);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    const script = (await handler()({ url: "/settings.js" })).body;
    const hostedLink = new Function("savedCard", script.match(/function hostedLink\(base\) \{[\s\S]*?\n\}/)[0] + "; return hostedLink;");
    for (const theme of Object.keys(cardPresets)) {
      // The gallery sends the chosen preset with the user's width; custom
      // values equal to Classic's defaults must still override a new style.
      for (const custom of [{}, { padding: 24, radius: 10, fontFamily: "system", progressHeight: 4 }]) {
        const card = { ...cardSettingsView({ card: { theme } }), ...custom };
        const preview = await fetch(`${app.url}/api/settings/card/preview.svg?theme=${theme}`);
        assert.equal(preview.status, 200);
        const saved = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ card }) });
        assert.equal(saved.status, 200);
        const view = (await saved.json()).card;
        const local = await (await fetch(`${app.url}/card.svg`)).text();
        const expected = renderCard(presence, optionsForView(view));
        assert.equal(local, expected);
        assert.equal(JSON.parse(await readFile(file, "utf8")).card.theme, theme);
        const link = new URL(hostedLink(view)("https://cards.example/u/preview.svg"));
        assert.equal(renderCard(presence, parseCardOptions(link.searchParams)), expected, `${theme}: hosted link matches saved local card`);
      }
    }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
