import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { previewArtwork } from "../src/setup-preview.js";
import { cardPresets } from "../src/card.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { cardSettingsView } from "../src/app-settings.js";
import { startAppFromConfig, hostedUploadSettings } from "../src/app-config.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { projectHostedState } from "../src/hosted-projection.js";
import { validateIngest } from "../hosted/lib/service.js";
import { sendCard, parseCardOptions } from "../hosted/lib/http.js";

const MEDIA = [
  { key: "music", kind: "track", title: "Blue Monday", item: { Type: "Audio", Name: "Blue Monday", Artists: ["New Order"], RunTimeTicks: 4_480_000_000 }, detail: "New Order" },
  { key: "movie", kind: "movie", title: "Spirited Away (2001)", item: { Type: "Movie", Name: "Spirited Away", ProductionYear: 2001, RunTimeTicks: 75_000_000_000 }, detail: "Movie" },
  { key: "tv", kind: "episode", title: "Lost", item: { Type: "Episode", Name: "The Constant", SeriesName: "Lost", ParentIndexNumber: 4, IndexNumber: 5, RunTimeTicks: 25_800_000_000 }, detail: "S04E05 · The Constant" },
];
const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "simulation", displayName: "Simulation" }, credentialStored: true, discordEnabled: false, hostedEnabled: false };
const output = process.env.CARD_SIMULATION_OUTPUT;
const outputRoot = output ? resolve(output) : null;

async function assertRaster(svg, width) {
  const { info } = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.ok(info.height >= 74 && info.height < 500);
  assert.doesNotMatch(svg.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, ""), /(?:NaN|Infinity|undefined)/);
  for (const match of svg.matchAll(/<(?:rect|image)\b[^>]*\bwidth="(-?[\d.]+)"[^>]*\bheight="(-?[\d.]+)"/g)) {
    assert.ok(Number(match[1]) >= 0 && Number(match[2]) >= 0, "no negative artwork or bar dimensions");
  }
}

function hostedSvg(presence, query) {
  const headers = {};
  let body;
  const res = { setHeader: (key, value) => { headers[key] = value; }, end: value => { body = value; } };
  sendCard({ method: "GET", headers: {} }, res, presence, parseCardOptions(query));
  assert.equal(res.statusCode, 200);
  assert.match(headers["content-type"], /svg/);
  return body;
}

test("simulated music, films and TV render through the running app in every style, state and size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-media-simulation-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig(BASE));
  const covers = Object.fromEntries(await Promise.all(MEDIA.map(async media => {
    const source = process.env.CARD_SIMULATION_COVERS
      ? await readFile(join(process.env.CARD_SIMULATION_COVERS, `${media.key}-cover.jpg`))
      : Buffer.from((await previewArtwork(media.key === "music" ? "music" : media.key === "movie" ? "film" : "episode")).split(",")[1], "base64");
    return [media.key, await sharp(source).png().toBuffer()];
  })));
  let media = MEDIA[0], state = "playing", artwork = true, brokenArt = false;
  const fixtureFetch = async url => {
    if (String(url).includes("/Images/")) return brokenArt ? new Response("missing", { status: 404 }) : new Response(covers[media.key] ?? covers.music, { headers: { "Content-Type": "image/png" } });
    return Response.json(state === "idle" ? [] : [{ UserId: "simulation", NowPlayingItem: { ...media.item, ...(artwork ? { Id: media.key, ImageTags: { Primary: "fixture-v1" } } : {}) }, PlayState: { PositionTicks: 830_000_000, IsPaused: state === "paused" } }]);
  };
  const provider = createJellyfinProvider({ baseUrl: BASE.serverUrl, apiKey: "fixture-token", fetchImpl: fixtureFetch });
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "fixture-token" }, port: 0, fetchImpl: fixtureFetch, discord: { env: {}, builtInClientId: "" } });
  try {
    if (output) await mkdir(output, { recursive: true });
    const page = await fetch(`${app.url}/settings`);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    const put = async (section, changes) => {
      const response = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ [section]: changes }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const get = async path => {
      const response = await fetch(`${app.url}${path}`);
      assert.equal(response.status, 200, path);
      return response.text();
    };
    for (media of MEDIA) for (const theme of Object.keys(cardPresets)) for (const width of [280, 440, 800]) for (state of ["playing", "paused", "idle"]) {
      await put("card", { ...cardSettingsView({ card: { theme } }), width });
      const svg = await get("/card.svg");
      await assertRaster(svg, width);
      if (state === "idle") {
        assert.match(svg, /Nothing playing/);
        assert.doesNotMatch(svg, /Blue Monday|Spirited Away|The Constant|<image /);
      } else {
        assert.ok(svg.includes(media.title), `${theme} ${media.key} ${state}: accessible full title`);
        assert.match(svg, state === "paused" ? /Paused|PAUSED/ : /Now playing|NOW PLAYING/);
        if (theme !== "compact") {
          assert.ok(svg.includes(media.detail), `${theme} ${media.key}: accessible detail`);
          assert.match(svg, /<image href="data:image\//);
        } else assert.doesNotMatch(svg, /<image /);
      }
      const preview = await get(`/api/settings/card/preview.svg?theme=${theme}&width=${width}`);
      await assertRaster(preview, width);
      if (state !== "idle") assert.ok(preview.includes(media.title));
      const raw = await provider.getPresence({ userId: "simulation" });
      const payload = projectHostedState(raw, hostedUploadSettings({ card: { theme } }), { seq: 1 });
      const accepted = validateIngest(payload);
      const hosted = hostedSvg(accepted, new URLSearchParams({ theme, width: String(width) }));
      await assertRaster(hosted, width);
      assert.doesNotMatch(hosted, /<image |fixture-token|127\.0\.0\.1/);
      if (state === "idle") assert.match(hosted, /Nothing playing/);
      else assert.ok(hosted.includes(media.item.Name), "hosted card retains the permitted media title");
      if (outputRoot && outputRoot.startsWith(resolve(process.cwd()) + "/") && state === "playing" && width === 440) {
        await writeFile(join(outputRoot, `${media.key}-${theme}.svg`), svg);
      }
    }
    // Privacy changes must invalidate prior art/title renders immediately.
    for (media of MEDIA) for (const theme of Object.keys(cardPresets)) {
      state = "playing";
      await put("card", { ...cardSettingsView({ card: { theme } }), width: 440 });
      for (const privacy of [
        { hideTitles: true }, { hideArtwork: true }, { hideProgress: true },
        { [media.kind === "movie" ? "hideMovies" : media.kind === "episode" ? "hideEpisodes" : "hideMusic"]: true },
      ]) {
        await put("privacy", { hideTitles: false, hideArtwork: false, hideProgress: false, hideMovies: false, hideEpisodes: false, hideMusic: false, ...privacy });
        for (const path of ["/card.svg", `/api/settings/card/preview.svg?theme=${theme}`]) {
          const svg = await get(path);
          await assertRaster(svg, 440);
          if (privacy.hideTitles) {
            assert.match(svg, /Private media/);
            assert.doesNotMatch(svg, /Blue Monday|New Order|Spirited Away|2001|The Constant|Lost|S04E05/);
          }
          if (privacy.hideArtwork) assert.doesNotMatch(svg, /<image /);
          if (privacy.hideProgress) assert.doesNotMatch(svg, /font-variant-numeric="tabular-nums"|height="[24]" rx="[01]" fill=/);
          if (privacy.hideMovies || privacy.hideEpisodes || privacy.hideMusic) {
            assert.match(svg, /Nothing playing/);
            assert.doesNotMatch(svg, /Blue Monday|Spirited Away|The Constant|Lost|<image /);
          }
        }
      }
      await put("privacy", { hideTitles: false, hideArtwork: false, hideProgress: false, hideMovies: false, hideEpisodes: false, hideMusic: false });
    }
    artwork = false;
    assert.doesNotMatch(await get("/card.svg"), /<image /);
    artwork = true; brokenArt = true; media = { ...MEDIA[0], key: "missing-cover" };
    assert.match(await get("/card.svg"), /Blue Monday/);
    assert.doesNotMatch(await get("/card.svg"), /<image /);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
