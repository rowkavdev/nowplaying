
# Artwork pipeline

nowplaying keeps media-server credentials and artwork origins out of public card output. Providers emit opaque references, the hosted process fetches and validates the image, and the SVG receives only a bounded raster data URI.

## Provider sources

| Provider | Source request | Credential placement |
| --- | --- | --- |
| Plex | `/photo/:/transcode` for the opaque server image path | `X-Plex-Token` request header |
| Jellyfin | `/Items/{id}/Images/Primary` | `X-Emby-Token` request header |
| Emby | `/Items/{id}/Images/Primary` | `X-Emby-Token` request header |
| Navidrome | Subsonic `getCoverArt.view` | hashed token and salt in the server-side query |

These requests happen only between nowplaying and the configured media server. Their URLs, headers and query strings are never copied into the generated SVG.

## Fetch, cache and fallback

The artwork service builds a provider request and applies a timeout, redirect rejection, a JPEG/PNG/WebP allowlist, declared and actual byte limits, and file-signature checks. Successful bytes become a `data:image/...;base64,...` value. The bounded LRU cache keys by provider, reference, image tag and rendition size, so artwork changes invalidate naturally. A 404 is cached for a shorter period to avoid repeated misses.

Missing references and cached 404s return `null`. The card then removes the artwork block and reclaims its width for text and progress instead of showing a broken-image icon.

## GitHub README and Camo

Embed the card endpoint as a normal Markdown image:

```md
![Now playing](https://your-nowplaying.example/card.svg)
```

GitHub rewrites external image URLs through its Camo image proxy. Camo fetches the outer SVG from the public card endpoint, not the private media server. Because the validated raster is embedded inside the SVG, the card does not contain a second private URL for Camo or a browser to resolve. This also prevents provider tokens, internal hostnames and direct media-server access from reaching a README reader.

The hosted card endpoint still sees Camo's fetch and must be public if the README is public. Configure card privacy independently from provider credentials. Never place a Plex token, Jellyfin/Emby API key, Navidrome token, or private server URL in a README image URL.

GitHub can cache proxied images. A changing query parameter on the outer card URL may be used as a cache-busting version, but it must contain no private metadata. Prefer a coarse generated-at version over track titles or item IDs.

## Sanitizer policy

The fetch layer validates transport, declared type, magic bytes, byte size and decoded pixel dimensions. The default sharp runtime then decodes one frame only, applies EXIF orientation, resizes to the requested rendition without enlargement, and emits a fresh PNG without copying EXIF, XMP or ICC metadata. Post-encode pixel and byte limits are enforced before output is cached or embedded. Cache keys carry the sanitizer/output policy version so future codec or format changes invalidate old entries.
