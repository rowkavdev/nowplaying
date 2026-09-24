# Documentation

Use this index to find the current reference or the design target for work that has not shipped yet.

## Use and operate

| Guide | Covers | Status |
| --- | --- | --- |
| [Provider configuration](providers.md) | Plex, Jellyfin, Navidrome and Emby authentication, behavior and normalized output | Current |
| [Deployment](deployment.md) | Local validation, planned README/Discord runtimes, networking, caching and operations | Current plus clearly labelled plans |
| [Customization](customization.md) | Shared templates, privacy, card themes and deep Discord settings | Design target for issue #25 |
| [Testing a dev build](testing-dev-build.md) | Checklist for trying the `dev` pre-release on a clean Windows machine | Current |
| [Security policy](../SECURITY.md) | Vulnerability reporting, deployment hardening, private data and secret handling | Current |

## Understand and contribute

| Guide | Covers | Status |
| --- | --- | --- |
| [Architecture](architecture.md) | Module boundaries, data flow, errors and extension points | Current plus planned output/runtime layers |
| [Contributing](../CONTRIBUTING.md) | Setup, style, testing, focused PRs, licensing and review checklist | Current |
| [Releases and versioning](releasing.md) | SemVer, immutable artifacts, checksums, provenance and migrations | Design target for issue #28 |

## Project references

- [Main README](../README.md): project overview, status and quick start
- [Roadmap issues](https://github.com/rowkavdev/nowplaying/issues): implementation work and acceptance notes
- [NOTICE](../NOTICE): adapted-code sources and attribution
- [AGPL-3.0 license](../LICENSE): project license

## Documentation rules

- State what works now before describing future work.
- Mark proposed configuration and workflow examples as design targets.
- Keep examples aligned with public exports and current package scripts.
- Use placeholders for tokens, URLs, people and media.
- Link protocol claims and adapted implementations to their source.
- Update this index when a guide is added, moved or replaced.
