# Architecture

`nowplaying` has one job at its center: turn incompatible media-server session payloads into one stable presence, then let independent outputs present it.

```text
Plex ---------\
Jellyfin ------> provider adapters -> normalized presence -> settings/privacy -> outputs
Navidrome ----/                                             |              |
Emby --------/                                         README SVG      Discord RPC
```

The provider-neutral boundary prevents a renderer from learning Plex XML, Jellyfin ticks, Navidrome's Subsonic response or Emby session fields. It also prevents provider credentials and full upstream payloads from leaking into an output by accident.

## Design goals

- One immutable model for every provider and output.
- Small adapters with explicit authentication and failure behavior.
- Presentation settings shared by card and Discord outputs where that makes sense.
- Provider polling separated from formatting, privacy and publishing.
- Safe defaults for public outputs.
- Deterministic units that can be tested without a live server.
- Small, reviewable changes that keep all supported Node versions green.

## Modules

### Presence model

`src/presence.js` owns the normalized value. It validates state, media type, text, time values and provider metadata, then freezes the result. Idle, playing and paused are explicit states rather than truthy flags.

The model is deliberately small. Provider payloads, authorization details and server implementation fields do not cross this boundary.

### Provider contract

`src/provider.js` defines the adapter shape and contract validation. An adapter exposes an identity and an asynchronous `getPresence(query)` method. Consumers depend on the contract, not concrete classes.

Provider-specific files under `src/providers/` own:

- request construction and authentication
- response parsing
- user/session selection
- provider units and media-type mapping
- artwork references
- translation into the normalized model

See [Provider configuration](providers.md).

### Card renderer

`src/card.js` is a pure renderer. Given a presence and presentation options, it returns SVG. It does not poll a server, store credentials or make network requests.

The current implementation escapes XML, supplies accessible title and description nodes, bounds layout values and renders playing, paused and idle states. Deep themes and field formatting will be added behind a validated settings layer.

### Discord output

Discord Rich Presence is planned as a second consumer of the normalized model. It will map text, artwork, timestamps, buttons and idle behavior after settings and privacy transforms. It must not become a second provider implementation.

A local Discord client identity and connection lifecycle will sit at the output edge. The core model must remain useful without Discord installed.

### Settings and privacy

The settings layer belongs between normalized presence and outputs. It will validate one documented configuration shape, merge defaults and apply output-specific sections.

Privacy is a transform, not a provider option. This gives every provider the same redaction rules and avoids relying on a public renderer to remember which upstream fields are sensitive.

Expected flow:

1. validate configuration;
2. fetch and normalize a presence;
3. apply audience/privacy policy;
4. format card or Discord fields;
5. publish through an output-specific transport.

### Runtime orchestration

A future runtime will schedule provider polling, retain only the state needed for idle/recently-played behavior and update enabled outputs. Polling failures should be observable without replacing the last good presence with misleading data.

Outputs need separate update policies. README cards are normally fetched on demand or cached by a hosted endpoint; Discord activity is pushed by a local process and should avoid redundant updates.

### Build and release

`scripts/build.js` currently copies publishable source, emits a sample SVG and writes a manifest as a reproducible smoke artifact. CI parse-checks source, runs tests on supported Node versions, collects coverage and validates that artifact.

The release pipeline will build from a tag, verify the clean artifact, attach checksums and publish provenance where GitHub supports it. Release jobs must not rebuild different bytes after approval.

## Data flow

A successful update follows these boundaries:

```text
provider credentials
       |
       v
provider HTTP client -- raw response
       |
       v
adapter parser -- normalized, immutable presence
       |
       v
privacy transform -- audience-safe presence
       |
       +--> card formatter --> SVG response/cache
       |
       +--> Discord formatter --> local RPC activity
```

Credentials are used only by the provider HTTP client. Raw responses end at the parser. Output modules receive neither.

## Error boundaries

Errors should carry enough context to diagnose the layer without containing secrets.

- Configuration errors fail before polling.
- HTTP, authentication and parse errors remain provider errors.
- Invalid normalized data fails at the model boundary.
- Unsupported presentation values fail settings validation.
- Output connection errors do not mutate provider state.
- An idle response is data, not a fallback for an exception.

Logs must redact authorization headers, URL credentials, query tokens and configured private fields.

## Extension points

### Add a provider

1. implement the provider contract in `src/providers/<name>.js`;
2. keep authentication and payload parsing inside that module;
3. map supported item types to the shared media types;
4. add synthetic fixtures and contract tests;
5. export the factory from the provider path and `src/index.js`;
6. document credentials, units and known limitations.

No card or Discord changes should be required.

### Add an output

1. consume the normalized model after privacy policy;
2. define output-specific settings under its own section;
3. keep transport and formatting separate where practical;
4. handle playing, paused, idle and unknown media explicitly;
5. test escaping, length limits and secret exclusion.

No provider changes should be required.

## Repository map

```text
src/
  index.js              stable public exports
  presence.js           normalized immutable model
  provider.js           adapter contract
  card.js               SVG output
  providers/            server-specific adapters
scripts/
  build.js              reproducible smoke build
test/                    model, contract, provider and renderer tests
docs/                    operational and design references
.github/workflows/       pull-request and build validation
```

## Compatibility

Node.js 22 is the minimum supported runtime. CI also tests Node.js 24. Public exports are intentional compatibility boundaries; internal file layout may change before the first stable release.

The project is ESM-only. New interfaces should use plain data and injected dependencies where possible so they remain testable and portable across self-hosted environments.
