# Run as a hosted service

Most people don't need this page. The normal setup runs on your Windows PC, and the README card is served by the project's hosted card service. This page is for running the card service yourself.

## The two parts

- **The app** (on your PC) reads your media server and pushes privacy-filtered updates. Discord Rich Presence always runs locally here; it can't be hosted.
- **The card service** answers public `/card.svg` requests. The project runs one at `nowplaying-hosted.vercel.app`, which is what the Settings page points at by default.

## Self-hosting the card service (advanced)

Reasons to self-host: your own domain, your own data boundary, or development.

1. Deploy the `hosted/` directory from the repository to Vercel or a Node host.
2. Bind it behind HTTPS. The card endpoint is public; keep everything else private.
3. In nowplaying's settings file, point `hosted.url` at your deployment (must be HTTPS).
4. Check `/healthz` answers `ok`, then watch the first card update arrive from your PC.

The card endpoint accepts only safe display options (theme, width, shown fields). Provider credentials stay on your PC and are never sent to any card service. Full reference: [hosted card deployment](https://github.com/rowkavdev/nowplaying/blob/main/docs/hosted-card.md) and [what leaves your PC](https://github.com/rowkavdev/nowplaying/blob/main/docs/hosted-upload.md).

## Running the app itself on a server

Running the polling app on a Linux server instead of a PC is a long-term goal, not shipped. Follow [#215](https://github.com/rowkavdev/nowplaying/issues/215) for macOS and Linux support.
