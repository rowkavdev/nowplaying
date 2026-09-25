# Advanced configuration

Everything here is optional. WebUI Settings covers normal use; this page is for people who want the file and command line.

## The settings file

Settings live at `%LOCALAPPDATA%\nowplaying\config.json`. It contains no passwords or tokens - those are in Windows Credential Manager - so it's safe to copy when asking for help. nowplaying backs the file up before upgrading its format, and unknown settings are rejected rather than silently ignored.

## What you can change

- Templates for the title, detail and state lines, with fields like `{title}`, `{series}`, `{episodeCode}` and `{year}`
- Card theme (`midnight-blue`, `paper`, `compact`), width (280-800 px) and which fields show
- `card.artworkTint` (default `true`): tint the card background from the cover's dominant colour; set `false` in `config.json` to turn it off
- Discord timestamps, idle behaviour and album art lookup (Discord wording, buttons and update interval can't be changed yet)
- Privacy mode and per-field hiding (see [Privacy and safe configuration](Privacy-and-safe-configuration))

Full option reference: [customization](https://github.com/rowkavdev/nowplaying/blob/main/docs/customization.md).

## Using nowplaying as a library

The package exports the provider adapters and card renderer for your own scripts:

```js
import { createJellyfinProvider, renderCard } from "nowplaying";

const provider = createJellyfinProvider({
  baseUrl: process.env.JELLYFIN_URL,
  apiKey: process.env.JELLYFIN_API_KEY,
});

const presence = await provider.getPresence({ username: "example" });
console.log(renderCard(presence));
```

Provider options and the normalized presence shape: [provider configuration](https://github.com/rowkavdev/nowplaying/blob/main/docs/providers.md). Architecture and internals: [architecture](https://github.com/rowkavdev/nowplaying/blob/main/docs/architecture.md).
