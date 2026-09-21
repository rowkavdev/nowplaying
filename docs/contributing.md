# Contributing

Contributions are welcome. Keep each change small, open an issue for user-visible behavior, and send it through a pull request. CI must pass before merge.

## Useful ways to help

- Test Plex, Jellyfin, Navidrome or Emby with playing, paused and idle media.
- Add card themes and layout controls that stay readable and deuteranopia-safe.
- Improve Windows packaging, updater rollback, privacy tests or documentation.
- Try Discord Rich Presence on Windows, macOS and Linux with different Discord clients.
- Report provider responses only after removing tokens, server addresses, usernames and media history.

## Discord Rich Presence example

A focused DRP contribution could add a configurable button label and URL without coupling Discord to provider polling:

```js
import { formatDiscordActivity } from "../src/discord.js";

const activity = formatDiscordActivity(presence, {
  details: "{title}",
  state: "{subtitle}",
  timestamps: "elapsed",
  buttons: [{ label: "View my now playing card", url: "https://cards.example.com/card.svg" }],
});
```

A good pull request for this example would:

1. extend and validate the provider-neutral Discord settings;
2. keep media-server credentials and account identifiers out of the activity;
3. add playing, paused, idle and invalid-URL tests;
4. document Discord's button limits and ensure existing settings still work;
5. update visual or serialized fixtures without adding real listening history.

Before implementing a larger DRP idea, open an issue with the desired activity shape, privacy impact and at least one concrete example. Avoid provider-specific fields in the Discord transport layer.

## Pull request checklist

- Add tests for success, failure and privacy boundaries.
- Run `npm run check`, `npm test` and `npm run test:coverage`.
- Do not commit credentials, private URLs or real media history.
- Preserve AGPL-3.0, NOTICE and DRPP-derived attribution.
- Keep the pull request to one reviewable change.
