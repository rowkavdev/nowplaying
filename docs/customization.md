# Customize NowPlaying

Open **Settings** from the tray icon. Each section saves separately; changing the preview does not save a setting.

## Card appearance

Choose **Appearance** in the settings navigation to open **Card Settings**. Pick a style, adjust the width, and press **Save**. The local card changes immediately. If you already embedded a hosted card, copy the updated README snippet from **Sharing** and replace the old one: appearance is part of that image's URL.

| Style | Look | Theme value |
| --- | --- | --- |
| Classic | Dark background, sans-serif type, blue progress | `midnight-blue` |
| Paper | White background and dark type | `paper` |
| Studio | Smaller rounded cover, warm accent, slim progress | `studio` |
| Editorial | Warm paper, serif title, square border, cover on the right | `editorial` |
| Terminal | Monospace type, muted green, square edges | `terminal` |
| Compact | A single title without artwork or progress | `compact` |

[See the card gallery](card-examples.md). Width can be 280–800 pixels. Hosted cards use these styles without artwork. The preview uses your current playback when available; when nothing is playing, it uses sample media and a placeholder cover.

**Fine-tune typography, artwork and layout** opens the detailed controls:

- padding and corner radius;
- named font or a custom stack of up to five plain font names;
- status text, border, background and progress bar appearance;
- artwork size, shape and side;
- line order, alignment and text direction.

Classic, Paper and Editorial choose artwork size by media type; Studio and Terminal use a smaller cover. The size sliders override those defaults. At narrow widths the renderer can reduce the displayed cover to leave room for text. The preview explains when this happens; your saved preference is kept.

Selecting a style resets these appearance controls to that style's defaults. It keeps the current width and reading direction. **Back to defaults** restores Classic at 440 pixels. Both actions are drafts until you press **Save**.

Fonts must be installed on the device viewing the SVG. A custom name does not download or embed a font. The local card can take a subtle tint from its cover; set `card.artworkTint` to `false` in `config.json` to disable that. Settings saves preserve your tint choice.

## Renderer and card links

`renderCard(presence, options)` accepts `theme`, `width`, validated six-digit `colors`, field visibility in `show`, `layout`, sanitized raster artwork in `artworkDataUri`, and a six-digit `tint`. Explicit layout and visibility options override the selected style.

```js
import { renderCard } from "nowplaying/card";

const svg = renderCard(presence, {
  theme: "editorial",
  width: 480,
  layout: { radius: 4, textAlign: "start" },
});
```

`show` accepts booleans for `artwork`, `mediaType`, `progress`, `state`, `subtitle` and `time`. A privacy filter must run before rendering; showing a field cannot recover data removed by that filter.

The local `/card.svg` URL accepts `theme`, `width` and comma-separated `show`. Hosted links also accept the public layout options documented in [hosted card deployment](hosted-card.md). Add `notime` to `show` to hide the clock. Credentials and custom text templates do not belong in a card URL.

## Discord

In **Discord Settings**, choose whether to publish presence, which timer to use, what happens when playback stops, and the status text shown beside your name. Spotify appears on cards only; it never feeds Discord.

For music the default status text is `{title} - {artist}`. Films and episodes use the app name unless you provide a custom status text. Leave the field empty to use those defaults.

Available fields: `{artist}`, `{title}`, `{subtitle}`, `{album}`, `{year}`, `{series}`, `{season}`, `{episode}`, `{episodeCode}`, `{service}`, `{provider}`, `{mediaType}`, `{state}`, `{stateLabel}`, `{position}`, `{duration}` and `{progressPercent}`. Write `{{` or `}}` for a literal brace. Unknown fields are rejected on save; the maximum is 128 characters.

**Show my server's cover** uploads a cover to a temporary public host so Discord can display it. The fallback MusicBrainz lookup sends a track title and artist. Read [artwork behavior](artwork.md#discord-cover-upload) before enabling either on an existing install. Other Discord line templates, buttons and the update interval are not editable in Settings.

## Privacy

**Privacy Settings** can hide titles, artwork, progress or whole media types across the local card, hosted card and Discord. A hidden media type appears as nothing playing. Privacy is applied before formatting or artwork lookup. [Privacy and safe configuration](wiki/Privacy-and-safe-configuration.md) explains these controls and where credentials are stored.
