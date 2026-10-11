# Settings

Open **Settings** from the tray icon, or visit `http://127.0.0.1:47832/settings` on the PC running NowPlaying. If you changed the local port, use that port instead. The page is local to your computer.

Configuration is on the left and recent app logs are on the right, following DRPP's desktop layout. On a small screen the logs sit below configuration. Use the shortcuts at the top to open and jump to a section. Accordion headings work with the keyboard too.

## Find a setting

| Section | Use it for |
| --- | --- |
| Media servers | Find, connect and remove Plex, Jellyfin, Emby or Navidrome servers |
| Connected services | Connect Spotify or sign in with GitHub for a shared hosted card |
| Card Settings / Appearance | Pick a card style, preview it, change width and fine-tune layout |
| Discord Settings | Enable presence, choose timers and status text, manage cover art |
| Privacy Settings | Hide titles, artwork, progress or media types across outputs |
| YouTube Settings | Copy or replace a browser-extension pairing code |
| Startup Settings | Start the app when you sign in |
| Hosted Card Settings / Sharing | Enable uploads and copy a public card link or README snippet |
| Hosted Card Devices | Manage PCs connected to your GitHub-linked card |

Sections that need an unavailable feature are hidden. For example, device management appears when the hosted account supplies that capability. First-run setup focuses on connecting a server; the full page appears once configuration is ready.

## Preview and save

Each section has its own **Save** button and feedback. A card preview updates before saving. Selecting a style resets that draft's look controls while keeping its width and reading direction. Detailed layout controls are under **Fine-tune typography, artwork and layout**. [Card styles and controls](customization.md).

A successful save applies to the running app. After changing the appearance of a hosted card, copy the new Markdown snippet into your README. Existing snippets keep their original URL options. GitHub may cache the card image; open the card link directly to compare.

A failed save leaves the stored configuration unchanged. Reloading abandons unsaved drafts. Sign-in, server removal, pairing-code changes and connection buttons perform their named action directly; they do not wait for a section's Save button.

## Logs

The log panel polls recent app events. **Search logs** accepts regular expressions; an invalid expression shows an error so you can correct it. **Auto Scroll** follows new entries; turn it off to inspect older messages. **Wrap Text** keeps long lines within the panel. These display preferences stay in this browser and do not change your app configuration.

Logs and Settings can include local server details. Check them before sharing a screenshot. [Troubleshooting](wiki/Troubleshooting.md) covers connection failures and useful diagnostic details.

## About and updates

**Info** opens the README, license and open-source attribution shipped with the app. The header shows the installed version when available. Use [updates and release channels](wiki/Updates-and-release-channels.md) for update behavior; Settings does not provide a manual update button.

### Cover art

The live preview uses the current album cover or poster. With nothing playing, it uses sample artwork. Hosted cards need **Hosted Card Settings → Include cover art** enabled separately. This shares a small sanitized image publicly, never your server address or the artwork URL. Hide artwork and Hide titles override hosted cover sharing. Compact is intentionally text-only.
