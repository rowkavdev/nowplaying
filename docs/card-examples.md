# Card styles

Choose **Settings → Appearance → Card Settings**. These examples come directly from the shipped local SVG renderer, with sample cover art for Studio, Editorial and Hi-Fi. Local cards show your server's cover or poster. Hosted README cards can include sanitized artwork when **Include cover art** is enabled; detailed episode metadata stays local.

## Classic

A familiar dark card with blue progress.

![Classic card showing Holocene by Bon Iver](assets/cards/music-playing.svg)

## Paper

White background, clear dark text.

![Paper card showing Holocene by Bon Iver](assets/cards/music-light.svg)

## Studio

Full-bleed artwork under a dark cinema shade, a framed cover and a two-line title.

![Studio card showing Blue Monday by New Order](assets/cards/studio.svg)

## Editorial

A large cover, serif title, warm paper and a perforated sleeve seam.

![Editorial card showing Blue Monday by New Order](assets/cards/editorial.svg)

## Hi-Fi

Monospace type with a muted green palette.

![Hi-Fi card showing Blue Monday by New Order](assets/cards/terminal.svg)

## Compact

Just the title, without artwork or progress by default.

![Compact card showing Holocene](assets/cards/compact.svg)

## Other playback states

| State | Example |
| --- | --- |
| TV episode | ![Lost, S04E05, The Constant](assets/cards/episode-playing.svg) |
| Film | ![Spirited Away, 2001](assets/cards/movie-playing.svg) |
| Paused | ![Paused music card](assets/cards/paused.svg) |
| Nothing playing | ![Idle card](assets/cards/idle.svg) |
| Titles hidden | ![Private media with progress](assets/cards/privacy-redacted.svg) |

Hiding a whole media type shows the idle state. Hiding progress also removes the timer. Privacy applies before any appearance choices.

See [customization](customization.md) for layout controls and theme names. After changing a saved style, copy the new hosted README snippet to update an existing embed.

For contributors: `node scripts/render-card-examples.js` regenerates these images. The example test checks that they match the renderer; visual fixtures also cover narrow cards, artwork, RTL and reordered fields.
