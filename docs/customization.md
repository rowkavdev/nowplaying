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

The hosted endpoint exposes a deliberately smaller public allowlist: `theme`, `width`, comma-separated `show` (with `notime` to hide the clock) and the layout and look options listed in the hosted card guide. Secrets, arbitrary colors and templates never enter public query strings.

Built-in palettes use color combinations selected to remain distinguishable for deuteranopia. Accessible title/description text is always emitted.

## Discord

Discord settings (Settings > Discord, saved to `config.json`):

- elapsed, remaining, both or no timestamps (`discord.timestamps`);
- idle behaviour (`discord.idleBehavior`);
- the status text next to your name (`discord.name`) and which line Discord shows there (`discord.statusDisplayType`: `name`, `state` or `details`);
- album art lookup (`discord.artworkLookup`, off by default).

Wording templates for the other lines, buttons, asset keys and the update interval can't be changed yet. Values for them in `config.json` are ignored, and a settings save removes them.

TV episodes with a known series show the series and episode code, for example "Lost" and "S04E05 · The Constant".

Discord Rich Presence runs locally and communicates with the user's Discord IPC socket. Analytics, when explicitly enabled, sends only one anonymous installation ping.

## Status text

Discord shows `<artist> on <service>` by default, for example "fakemink on Spotify". Films and episodes keep Discord's own app name unless you set a status text. Change it in Settings > Discord > Status text, or set `discord.name` in `config.json`. Leave it empty for the default.

Write fields in braces: `{artist}`, `{title}`, `{subtitle}`, `{album}`, `{year}`, `{series}`, `{season}`, `{episode}`, `{episodeCode}`, `{service}` (Spotify, Navidrome, Plex and so on), `{provider}`, `{mediaType}`, `{state}`, `{stateLabel}`, `{position}`, `{duration}` and `{progressPercent}`. Other text is kept as typed. Write `{{` or `}}` for a literal brace. A field that is not in this list is rejected when you save. The text can be 128 characters at most. With hidden titles on, `{artist}` is blank.

## Privacy

Privacy is applied before formatting. Removed data cannot be restored by card or Discord visibility settings.

Available controls include private/friends/public/custom modes, title redaction/replacement, artwork removal, progress removal and media-kind suppression. Public deployments should start with conservative policy and widen fields intentionally.

## Further layout work

The next customization slices will remain backward-compatible and small. Candidate controls include padding/corner radius, typography scale, artwork placement, progress dimensions/position, field order and RTL-aware alignment. These are not yet accepted renderer options; unsupported keys continue to fail validation rather than silently doing nothing.
