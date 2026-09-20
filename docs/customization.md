# Customization reference

Deep customization is planned under issue [#25](https://github.com/rowkav09/nowplaying/issues/25). This document records the intended settings model so implementation, tests and user documentation can converge on one contract.

> The settings schema below is a design target, not a shipped configuration API. The current `renderCard(presence, options)` supports only its existing renderer options. Examples in this file must not be treated as working configuration until issue #25 is complete.

Customization belongs after provider normalization. A Plex user and a Jellyfin user should get the same output controls, and changing a theme must not alter provider polling.

## Design rules

- Start with safe, readable defaults.
- Share formatting concepts across card and Discord outputs where their constraints overlap.
- Keep output-specific values in `card` and `discord` sections.
- Validate unknown keys, enum values, colors, lengths and URLs before polling.
- Apply privacy before formatting and publishing.
- Define behavior for playing, paused, idle and unavailable states.
- Keep templates declarative. Do not execute user-supplied JavaScript.
- Make every preset expandable into ordinary documented settings.

## Proposed shape

```jsonc
{
  "locale": "en-GB",
  "privacy": {
    "mode": "public",
    "hideUsers": true,
    "hideProviders": true,
    "hideArtwork": false,
    "redactTitles": false
  },
  "format": {
    "title": "{title}",
    "details": "{subtitle}",
    "state": "{stateLabel}",
    "separator": " · ",
    "emptyValue": ""
  },
  "card": {
    "theme": "midnight-blue",
    "width": 420,
    "height": "auto",
    "show": {
      "provider": false,
      "mediaType": true,
      "year": true,
      "progress": true,
      "artwork": true,
      "state": true
    }
  },
  "discord": {
    "enabled": true,
    "details": "{title}",
    "state": "{subtitle}",
    "timestamps": "elapsed",
    "idleBehavior": "clear",
    "buttons": []
  }
}
```

The final names may change during implementation. Migration notes will accompany any change after a versioned schema ships.

## Template fields

Formatting strings will use named placeholders rather than positional interpolation.

| Field | Meaning | Typical media |
| --- | --- | --- |
| `{title}` | Primary movie, episode or track title | All |
| `{subtitle}` | Show, artist or secondary context | Episode, track |
| `{album}` | Album name | Track |
| `{year}` | Release year | Movie, episode, track |
| `{provider}` | Provider display name | All |
| `{mediaType}` | Normalized media type | All |
| `{state}` | Raw normalized state | All |
| `{stateLabel}` | Localized playing/paused/idle label | All |
| `{position}` | Formatted playback position | Playing, paused |
| `{duration}` | Formatted total duration | Playing, paused |
| `{progressPercent}` | Rounded progress percentage | Playing, paused |

A missing value should remove its immediately associated separator rather than leave output such as `Song ·  · Album`. The settings implementation should provide structured fallback lists for complex cases instead of growing conditional syntax inside templates.

Template output must be escaped for its destination. SVG/XML, Discord text and URLs have different constraints.

## Shared formatting

Planned shared options:

| Setting | Purpose |
| --- | --- |
| `locale` | Labels, number formatting and time formatting |
| `format.title` | Primary output line |
| `format.details` | Secondary output line |
| `format.state` | Playback-state line or badge |
| `format.separator` | Separator used when optional fields join |
| `format.emptyValue` | Explicit fallback when a field is absent |
| `labels.playing` | Override playing label |
| `labels.paused` | Override paused label |
| `labels.idle` | Override idle label |
| `labels.unavailable` | Override stale/error label |

Templates will have documented length limits. Validation should report the setting path and limit before an output rejects it.

## Privacy

Privacy settings transform normalized presence before card or Discord formatting. Output-specific visibility cannot restore data removed by privacy policy.

Planned modes:

| Mode | Intent |
| --- | --- |
| `private` | Local testing; no publishing unless an output is explicitly enabled |
| `friends` | Rich presence for a known audience with configurable field removal |
| `public` | Conservative defaults for a public README card |
| `custom` | Explicit field-level rules |

Planned controls include:

- redact or replace title and subtitle;
- remove provider and profile identity;
- remove artwork;
- round or hide progress;
- delay updates;
- suppress selected media types;
- allow or deny values using patterns;
- choose idle and error disclosure;
- set an audience-safe fallback presence.

Pattern rules must be bounded and tested against denial-of-service behavior. Logs use the privacy-filtered form or metadata-only events, not raw titles.

## Card settings

The card renderer already handles playing, paused and idle states, XML escaping, accessible text and bounded widths. The settings layer will expose those choices in a validated form.

### Layout

Planned layout controls:

- width and bounded height;
- padding and corner radius;
- artwork placement and size;
- text alignment and maximum lines;
- progress-bar position and thickness;
- compact and full layouts;
- field order;
- gap scale;
- right-to-left layout where the chosen locale needs it.

Fixed-size cards need deterministic truncation. Layout should not change width based on private title length.

### Visibility

`card.show` will control provider, media type, year, progress, artwork, playback state and timestamps. Hiding a field must reclaim its space rather than leave an empty row.

### Themes

Built-in themes will provide full color tokens rather than one accent:

```jsonc
{
  "background": "#0f172a",
  "surface": "#172033",
  "text": "#f8fafc",
  "mutedText": "#a8b3c7",
  "accent": "#38bdf8",
  "progressTrack": "#334155",
  "border": "#334155",
  "playing": "#38bdf8",
  "paused": "#f2c14e",
  "idle": "#94a3b8"
}
```

Colors will accept a restricted CSS color syntax and be normalized before rendering. Themes must meet text/background contrast targets and use labels or shape in addition to color. The default palette remains deuteranopia-safe.

Planned theme behavior:

- named built-in preset;
- optional per-token overrides;
- light/dark presets;
- no remote CSS;
- no arbitrary SVG markup;
- stable snapshot examples in the docs.

### Artwork

Planned artwork sources and fallbacks:

1. provider artwork after safe server-side retrieval;
2. media-type icon;
3. configured static image;
4. no artwork with layout reflow.

A public SVG must not expose a private media-server artwork URL or token. The hosted service should proxy/cache approved artwork, validate content type and size, and strip active content. Data URLs and arbitrary remote schemes should be rejected unless a later policy explicitly permits them.

### Progress and time

Card progress controls will include bar visibility, numeric elapsed/remaining text, percentage rounding and paused appearance. Values stay clamped between zero and duration. Unknown duration hides progress rather than inventing one.

## Discord Rich Presence settings

Discord settings are inspired by the depth users expect from established Plex Rich Presence tools while staying provider-neutral.

### Text fields

Planned fields:

- `discord.details`: first activity line;
- `discord.state`: second activity line;
- `discord.largeText`: large-image hover text;
- `discord.smallText`: small-image hover text;
- per-media-type template overrides;
- playing, paused and idle overrides.

Discord's current API limits must be checked during implementation and encoded in validation. The formatter will truncate by Unicode code points without splitting surrogate pairs or leaving broken separators.

### Assets

Planned options:

- provider, media-type or artwork large image;
- state or provider small image;
- configured fallback asset keys;
- hover-text templates;
- artwork proxy policy;
- disable dynamic artwork.

Discord application assets and dynamic external artwork follow different APIs. Configuration validation must distinguish an asset key from a URL.

### Timestamps

Planned timestamp modes:

| Mode | Behavior |
| --- | --- |
| `elapsed` | Show playback elapsed time |
| `remaining` | Show estimated end time |
| `both` | Use Discord's supported start/end display |
| `none` | No activity timestamp |

Paused behavior will be configurable: freeze displayed time, hide timestamps or keep the last calculated interval. The default should not imply playback is advancing while paused.

### Buttons

Up to the number Discord currently permits may be configured. Each button will have a label template and validated HTTPS URL. Provider tokens, private origins and user identifiers must not be interpolated into a button URL.

Buttons require an explicit privacy decision because they send viewers outside Discord. No button is the default.

### Idle and error behavior

Planned idle modes:

- clear activity immediately;
- clear after a grace period;
- show a neutral idle activity;
- retain a privacy-filtered recently played activity for a bounded time.

An upstream error is not idle. Error policy may retain the last good activity for a short, visible staleness window or clear it. It must never publish an exception message or raw provider status.

### Update control

Planned controls include minimum update interval, progress-update cadence, debounce window and reconnect backoff. Text-identical activities should not be re-sent. Provider polling cadence remains a runtime setting rather than a Discord format setting.

## Per-media overrides

Cards and Discord may need different formats for movies, episodes and tracks. Overrides will merge in a fixed order:

```text
defaults
  -> named preset
  -> user shared settings
  -> output settings
  -> media-type settings
  -> state settings
```

Later layers override earlier scalar values. Objects merge by key. Arrays replace rather than concatenate unless a setting explicitly documents another behavior. `null` should mean “clear this optional value” only where the schema permits it.

Example target:

```jsonc
{
  "discord": {
    "details": "{title}",
    "state": "{subtitle}",
    "media": {
      "episode": {
        "details": "{title}",
        "state": "{subtitle} · {year}"
      },
      "track": {
        "details": "{title}",
        "state": "by {subtitle}"
      }
    }
  }
}
```

## Validation and diagnostics

Settings validation should produce stable errors such as:

```text
card.width: must be between 240 and 800
card.theme.accent: expected a supported color
 discord.buttons[0].url: expected an HTTPS URL
```

A `check-config` command is planned before any runtime starts. A redacted effective-config view should make defaults and merge order inspectable without printing secrets.

Unknown settings should fail by default. A future compatibility mode may warn during a documented migration, but silently ignoring a misspelled privacy key is unsafe.

## Presets

Initial presets should be small and opinionated:

- `midnight-blue`: default dark, deuteranopia-safe card;
- `paper`: high-contrast light card;
- `compact`: no artwork, reduced vertical space;
- `private-discord`: rich local activity, no external buttons;
- `public-readme`: conservative fields and proxied/no artwork.

Presets are configuration bundles, not hidden renderer branches. Documentation will show their expanded settings and screenshots after implementation.

## Implementation order

Issue #25 should land in small pull requests:

1. schema, defaults and validation;
2. safe shared templates and fallback behavior;
3. privacy transform;
4. card visibility and layout settings;
5. theme tokens and preset snapshots;
6. Discord text, asset and timestamp settings;
7. Discord buttons, idle and update controls;
8. config diagnostics, examples and migration tests.

Each step must keep existing provider and renderer behavior compatible or document the deliberate change.
