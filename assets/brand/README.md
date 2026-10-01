# Brand assets

Flat purple play mark, `now` + `playing` wordmark, Inter. No gradients.

| Colour | Hex | Use |
| --- | --- | --- |
| Primary | `#7C3AED` | mark, links, focus |
| Secondary | `#A855F7` | inner triangle, wordmark on dark |
| Accent | `#EC4899` | sparingly |
| Background (dark) | `#0B0B12` | app icon, banner, installer |
| Surface (dark) | `#1F1F28` | cards on dark |
| Text (secondary) | `#9CA3AF` | captions |
| Border (light) | `#E5E7EB` | outlines on light |
| Background (light) | `#F8FAFC` | light icon |

Never use red against green to mean something. Use shape, text or the blue/orange/purple range instead.

## Files

- `mark.svg`, `icon-dark.svg`, `icon-light.svg`, `icon-mono.svg`, `logo.svg`, `logo-dark.svg`, `banner.svg`: SVG masters.
- `png/`: icon sizes, touch icon and favicons. The 16 and 32 px favicons drop the inner triangle.
- `../nowplaying.ico`: app, tray and installer icon (16, 24, 32, 48, 64, 128, 256 px).
- `../discord-fallback.png`: Discord image when no cover can be shown.
- `installer/`: Inno Setup wizard images (`wizard-side.bmp` 430x824, `wizard-small.bmp` 110x110, 24-bit BMP).
- `wordmark-paths.json`: Inter Bold outlines for the wordmark, so nothing needs the font installed.

Inter is licensed under the SIL Open Font License 1.1 (`Inter-LICENSE.txt`).

## Rebuild

```
node scripts/brand/render.mjs
```

`scripts/brand/outline-wordmark.py` regenerates `wordmark-paths.json` from `Inter-Bold.ttf` (needs `fonttools`). The renderer writes every file above from the source geometry.
