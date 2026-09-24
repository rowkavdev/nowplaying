# Customization reference

Customization is provider-neutral and applied after polling. The same normalized presence can feed cards and Discord without changing provider behavior.

## Shipped settings

`createSettings()` validates unknown keys and deep-merges immutable defaults for:

- locale;
- privacy mode and field removal;
- shared title/detail/state templates and separators;
- card theme, width and field visibility;
- Discord enablement, templates, timestamps and idle behavior.

Templates support documented named presence fields. Missing values remove their associated empty segments rather than leaving doubled separators. Output escaping remains destination-specific.

## Cards

`renderCard(presence, options)` supports:

- `theme`: `midnight-blue`, `paper` or `compact`;
- `width`: integer from 280 to 800;
- `colors`: validated six-digit overrides for the selected palette;
- `show`: booleans for artwork, media type, progress, state and subtitle;
- `artworkDataUri`: validated, sanitized PNG/JPEG/WebP data.

`card.artworkTint` (config.json only, default `true`): the card background takes a tint from the cover's dominant colour, kept in a safe lightness range so text stays readable on white or black covers. Set it to `false` in `config.json` to turn it off; settings saves keep your choice.

The hosted endpoint exposes a deliberately smaller public allowlist: `theme`, `width` and comma-separated `show`. Secrets, arbitrary colors and templates never enter public query strings.

Built-in palettes use color combinations selected to remain distinguishable for deuteranopia. Accessible title/description text is always emitted.

## Discord

Discord settings support:

- `details`, `state` and `largeText` templates;
- bounded large/small asset keys;
- elapsed, remaining, both or no timestamps;
- clear/show idle behavior;
- up to two safe HTTPS buttons;
- update intervals from 5 seconds to 5 minutes;
- lifecycle dedupe and throttling.

TV episodes with a known series use their own defaults: `details` shows `{series}` and `state` shows `{episodeCode} · {title}`, for example "Lost" and "S04E05 · The Constant". This only applies while `details` or `state` is still the plain default (`{title}` / `{subtitle}`), so a custom template always wins. Templates can also use `{series}`, `{season}`, `{episode}`, `{episodeCode}` and `{year}` directly.

Discord Rich Presence runs locally and communicates with the user's Discord IPC socket. Analytics, when explicitly enabled, sends only one anonymous installation ping.

## Privacy

Privacy is applied before formatting. Removed data cannot be restored by card or Discord visibility settings.

Available controls include private/friends/public/custom modes, title redaction/replacement, artwork removal, progress removal and media-kind suppression. Public deployments should start with conservative policy and widen fields intentionally.

## Further layout work

The next customization slices will remain backward-compatible and small. Candidate controls include padding/corner radius, typography scale, artwork placement, progress dimensions/position, field order and RTL-aware alignment. These are not yet accepted renderer options; unsupported keys continue to fail validation rather than silently doing nothing.
