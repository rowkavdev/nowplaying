
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


## Discord artwork

Discord fetches the large image itself, so it can only show artwork from a public HTTPS URL. A private media server's image URL never works there and would leak the server's address, so nowplaying picks the Discord image in this order:

1. **Provider image** - used only if it is a public HTTPS URL with no embedded credentials and no token-like query parameters (`X-Plex-Token`, `api_key`, Subsonic `t`/`s`/`u` and similar).
2. **Public proxy** - if you run a public artwork proxy, its base URL plus an opaque hash of the artwork reference. The private host and item IDs are never part of the URL. Set it with `discord.artworkProxy` (for example `"https://art.example.com/discord"`); it must be a public HTTPS URL with no credentials or query string. Empty (the default) turns this step off.
3. **Server cover upload** - choose **Show my server's cover** under **Settings > Discord > Album art** (`discord.artworkUpload`, see [Discord cover upload](#discord-cover-upload)). nowplaying takes the same sanitized cover the card uses and uploads just that image to [Litterbox](https://litterbox.catbox.moe/) (a temporary public host, 72 hours), then gives Discord the returned HTTPS URL. This is how [Discord Rich Presence for Plex](https://github.com/phin05/discord-rich-presence-plex) gets Plex posters into Discord. No title, artist, token or server address is sent, only the image. Turn off hidden artwork in privacy and nothing is uploaded.
4. **Metadata lookup** - optional: choose **Look up covers on MusicBrainz** under **Settings > Discord > Album art**, then press **Save** to set `discord.artworkLookup: "musicbrainz"`. Choose **Only use art from my server** to avoid the lookup. Existing configs keep their saved choice until you change it in Settings. nowplaying then sends only the track title and artist to [MusicBrainz](https://musicbrainz.org/) and, for a confident match (score 90 or higher), points Discord at that release's front cover on the [Cover Art Archive](https://coverartarchive.org/). No server address, username, token or other metadata is sent. Requests identify nowplaying with a User-Agent and are limited to about one per second, following the MusicBrainz rules. `"off"` sends nothing. Only music tracks with both a title and an artist are looked up: films, episodes, shows and tracks with no artist go straight to the next step, so nothing picks up a random cover by title alone.
5. **Fallback image** - the NowPlaying icon, served as a public HTTPS image from this repo (`assets/discord-fallback.png`), so Discord never shows a "?" placeholder. `discord.largeImage` can override it with an uploaded Discord asset key or another public HTTPS image URL.

URLs are rejected for loopback, private, link-local and CGNAT IPv4 ranges, private, link-local and IPv4-mapped IPv6 addresses, `localhost`, single-label hostnames and local suffixes such as `.local`, `.lan` and `.home.arpa`. Video or motion artwork (`.m3u8`, `.mp4`, `.webm` and similar) is skipped too, because Discord shows it as a blank image.

Results are cached for six hours; misses and upload failures are cached for ten minutes. **Refresh album art** in **Settings > Discord** clears both the local media-server cover cache and Discord's cached cover or miss, then tries again immediately. The status page shows the selected artwork source and recovery guidance. The status API (`discord.artwork`) and downloaded diagnostics (`discordArtwork`) expose only `source` (`provider`, `proxy`, `upload`, `lookup`, `fallback` or `none`) and a short `reason`, never the URL, host, token or lookup error text.

## Discord cover upload

Discord can only show a cover that sits at a public address, and a Plex, Jellyfin or Emby cover is not. So **Show my server's cover** in Settings > Discord is the way to get one there. It is on for a new setup. A config saved before the option existed keeps it off until you tick it, and a config that had chosen `artworkLookup: "upload"` keeps it on. When a track plays, nowplaying downloads the cover from your server and uploads it to litterbox.catbox.moe. Litterbox deletes the file after 72 hours. Discord gets the public link.

Untick **Show my server's cover** to turn it off, or set `discord.artworkUpload` to `false`. Hiding artwork or titles under Privacy also turns it off. If the upload fails, the "If that fails" setting picks MusicBrainz or the plain icon.

The image host can reject or rate-limit an upload. An HTTP 403 is reported as `upload_blocked`; it describes the external upload service, not media-server or Discord authentication. `upload_rate_limited`, `upload_timeout` and `upload_error` identify other temporary failures. NowPlaying retries automatically and shows the selected fallback. It never silently uploads to another host; choose MusicBrainz explicitly in **Settings > Discord** if you want that alternative.
