# Security policy

`nowplaying` handles media-server credentials and activity that may be private. Security reports are welcome even while the repository is in private early development.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include secrets in issue text.

Use GitHub's private vulnerability reporting for this repository when it is available under the **Security** tab. If that option is not visible, contact the repository owner privately through their GitHub profile and include only enough detail to arrange a secure handoff.

Include:

- the affected version, commit or branch
- the provider or output involved
- steps to reproduce with secrets removed
- expected and observed behavior
- the practical impact
- any suggested fix, if known

Do not include API keys, access tokens, passwords, private server URLs, user names, unredacted logs or real now-playing history. Use clear placeholders.

The maintainer will acknowledge a usable report, investigate it and coordinate disclosure. Response times are best-effort during early development; please allow time before publishing details.

## Supported versions

The project does not have a stable release yet. Security fixes apply to the current `main` branch until versioned releases begin. After that, this section will list supported release lines.

| Version | Supported |
| --- | --- |
| Current `main` | Yes |
| Unreleased branches and old commits | No |

## Deployment guidance

The hosted endpoint, privacy controls and production deployment flow are not finished. Treat current deployments as development instances.

- Keep the service private or behind authentication.
- Bind to a private interface unless public access is intentional.
- Use TLS for traffic to the service and media server.
- Put credentials in environment variables or a dedicated secret store.
- Give tokens the least access the provider supports.
- Do not put provider tokens in card URLs, browser code, SVG output or Discord activity fields.
- Do not log full upstream request URLs when they can contain credentials.
- Rotate a credential immediately if it appears in a commit, CI output, screenshot or issue.
- Restrict network access so the process can reach only the media server and output services it needs.
- Keep Node.js and the host operating system supported and patched.

## Privacy model

A presence can expose titles, artists, shows, playback progress, artwork, profile names and timestamps. That data can reveal habits or sensitive viewing history.

Before publishing a card or Discord activity:

1. choose which profile or user may be shown;
2. decide which fields are safe for that audience;
3. test idle, paused and unknown-media behavior;
4. verify that provider URLs and identifiers are not rendered;
5. use the planned privacy controls before making the endpoint public.

The normalized model intentionally excludes provider payloads and credentials. Output renderers should consume only that model and explicit presentation settings.

## Secret handling for contributors

Tests must use synthetic fixtures. Never record real provider responses without removing:

- tokens and authorization headers
- server and artwork URLs
- account names and IDs
- device names and IP addresses
- titles or libraries that identify a person

If a secret is committed, deleting the line is not enough. Revoke or rotate the secret first, then remove it from current and historical repository data as needed.

## Dependencies and automation

The runtime currently has no third-party package dependencies. CI still treats workflow changes and pinned action versions as security-sensitive. Future dependencies should be minimal, reviewed and covered by automated updates and vulnerability scanning.

Release automation must use least-privilege workflow permissions, immutable artifacts and checksums. Provenance should be generated where the release platform supports it.
