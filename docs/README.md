# Documentation

Two audiences, two homes:

- **Using nowplaying?** Start with the [user wiki](https://github.com/rowkavdev/nowplaying/wiki): quick start, install, provider sign-in, card and Discord setup, privacy and troubleshooting. The wiki is sourced from [docs/wiki/](wiki/) and lands through PRs like any other change.
- **This folder** keeps the reference material: exact behaviour, configuration and design notes.

## Reference guides

| Guide | Covers | Status |
| --- | --- | --- |
| [Provider configuration](providers.md) | Plex, Jellyfin, Navidrome and Emby adapter options and normalized output | Current |
| [Customization](customization.md) | Templates, privacy controls, card themes and Discord settings | Current |
| [Card examples](card-examples.md) | Renderer-generated gallery of every card state and theme | Current |
| [Hosted card deployment](hosted-card.md) | Running the card endpoint: routes, headers, caching, health checks | Current |
| [Hosted card: what leaves your PC](hosted-upload.md) | Exactly which fields the app pushes to the card service | Current |
| [Updates](updates.md) | Update policy, channels, verification, atomic install and rollback | Current |
| [Testing a dev build](testing-dev-build.md) | Checklist for trying the `dev` pre-release on a clean Windows machine | Current |
| [Troubleshooting](troubleshooting.md) | Diagnostics by symptom, log locations and privacy-safe reporting | Current |
| [Analytics](analytics.md) | Aggregate-only analytics and the download badge | Current |
| [Artwork](artwork.md) | Artwork fetching, sanitizing, caching and embedding | Current |
| [Windows packaging](windows-packaging.md) | Installer and portable ZIP layout, and why native files sit beside the EXE | Current |
| [Deployment](deployment.md) | Self-hosting design notes: network boundaries, polling, supervision, containers | Partly design target; the hosted card and Windows app sections predate what shipped |
| [Releases and versioning](releasing.md) | SemVer, immutable artifacts, checksums, provenance and migrations | Current |
| [Security policy](../SECURITY.md) | Vulnerability reporting, deployment hardening, private data and secret handling | Current |

## Contributor docs

| Guide | Covers | Status |
| --- | --- | --- |
| [Architecture](architecture.md) | Module boundaries, data flow, errors and extension points | Current |
| [Contributing](../CONTRIBUTING.md) | Setup, style, testing, focused PRs, licensing and review checklist | Current |

## Project references

- [Main README](../README.md): project overview, status and quick start
- [Roadmap issues](https://github.com/rowkavdev/nowplaying/issues): implementation work and acceptance notes
- [NOTICE](../NOTICE): adapted-code sources and attribution
- [AGPL-3.0 license](../LICENSE): project license

## Documentation rules

- State what works now before describing future work, and label planned behaviour as planned.
- The wiki is the canonical user guide; this folder is the canonical reference. Don't duplicate setup steps in both - link them.
- Keep examples aligned with public exports and current package scripts.
- Use placeholders for tokens, URLs, people and media.
- Update this index when a guide is added, moved or replaced.
