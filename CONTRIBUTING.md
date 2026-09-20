# Contributing

Thanks for helping build `nowplaying`. The project is in private early development, so interfaces can change, but changes should still be easy to review, test and undo.

## Before you start

- Search [existing issues](https://github.com/rowkav09/nowplaying/issues) before opening another.
- Use a focused issue for a behavior change or sizable documentation task.
- Keep pull requests small. One provider, output behavior, validation rule or document is usually enough.
- Discuss large architecture changes before writing them.
- Never put real media-server credentials, URLs or activity data in issues, fixtures or screenshots.

Security problems follow [SECURITY.md](SECURITY.md), not public issues.

## Development setup

Requirements:

- Node.js 22 or 24
- npm from the chosen Node.js release
- Git

```bash
git clone https://github.com/rowkav09/nowplaying.git
cd nowplaying
npm install
npm run check
npm test
npm run build
```

The package has no runtime dependencies yet. Do not add one when a small platform API or local helper is enough.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Parse-check source, provider modules and tests |
| `npm test` | Run all Node tests |
| `npm run test:coverage` | Run tests with the built-in coverage report |
| `npm run build` | Create and smoke-test `dist/`, including a sample SVG |

Run all four before opening a pull request. CI repeats them across supported Node versions and validates the build artifact.

## Branches and pull requests

Use a short branch name that describes the change, for example:

```text
feat/discord-timestamps
docs/deployment-guide
fix/navidrome-user-match
```

A pull request should:

- explain what changed and why;
- link its issue when one exists;
- include tests for behavior changes;
- update relevant docs in the same focused change;
- avoid unrelated formatting or refactors;
- keep generated artifacts out of commits unless the release process requires them;
- pass every required check before merge.

Use plain commit subjects in the form `area: action`, such as `providers: add Emby adapter` or `docs: explain token handling`.

## Code style

The codebase uses ESM and the Node.js standard library.

- Use `const` unless reassignment is required.
- Prefer small functions with explicit inputs and returned values.
- Inject network and transport dependencies for deterministic tests.
- Validate at module boundaries rather than relying on coercion.
- Keep provider-specific fields inside provider adapters.
- Do not catch an error merely to return idle presence.
- Keep user-facing strings and XML escaped at the output boundary.
- Add comments for constraints and source attribution, not for obvious syntax.

There is no formatter dependency. Match the surrounding two-space indentation, semicolons and double-quoted strings.

## Testing

Tests use `node:test` and `node:assert/strict`.

Behavior changes need tests that cover the important state and at least one failure path. Prefer synthetic payloads close to the provider format over mocks that only return the final normalized object.

### Provider tests

Cover:

- required configuration;
- request URL and authentication without exposing token values;
- user/session selection;
- playing and paused behavior where the provider supports both;
- media-type and text mapping;
- position and duration units;
- empty session lists;
- non-success HTTP responses;
- malformed or unsupported payloads.

### Renderer tests

Cover:

- playing, paused and idle states;
- XML escaping;
- invalid and bounded layout inputs;
- missing optional metadata;
- accessible title and description text;
- privacy settings before adding a field to public output.

Tests and fixtures must not contain copied personal activity or credentials. Use names such as `Test User`, `Example Movie` and `https://media.example.test`.

## Adding a provider

Read [docs/architecture.md](docs/architecture.md) and [docs/providers.md](docs/providers.md) first.

1. create `src/providers/<provider>.js`;
2. implement and validate the provider contract;
3. keep HTTP authentication, parsing and units in that module;
4. return the shared immutable presence model;
5. add contract and provider tests;
6. export the factory through its subpath and `src/index.js`;
7. update package exports and provider docs;
8. add source and license notices for adapted code.

A provider pull request should not also add output-specific formatting.

## Adding or changing an output

An output consumes normalized presence after shared privacy policy. It must not read raw provider payloads or credentials.

Document:

- field length and character constraints;
- artwork and URL behavior;
- playing, paused, idle and error behavior;
- update or cache strategy;
- audience and privacy implications.

Visual changes require inspection of the rendered SVG or UI, not only string assertions. Include before/after evidence in the pull request when layout or color changes.

## Documentation

Documentation must distinguish current behavior from planned work. Examples should be copyable, use placeholders for secrets and match current public exports. Link to source references when describing a provider protocol or adapted implementation.

Use direct language and descriptive headings. Avoid claims such as “secure” or “production-ready” without a specific guarantee and test.

## Licensing and adapted code

Contributions are accepted under [AGPL-3.0](LICENSE).

The Plex adapter contains work adapted from DRPP under the same license. Keep its file-level source, copyright and license notice. Any new copied or adapted code must have a compatible license and a clear source record in the file and [NOTICE](NOTICE) when appropriate.

Do not paste code from a project until its license and attribution requirements have been checked.

## Review checklist

Before requesting review:

- [ ] scope is one focused change;
- [ ] public behavior and compatibility impact are clear;
- [ ] tests cover success and failure behavior;
- [ ] `npm run check` passes;
- [ ] `npm test` passes;
- [ ] `npm run test:coverage` passes;
- [ ] `npm run build` passes;
- [ ] docs and package exports are current;
- [ ] logs, fixtures and screenshots contain no private data;
- [ ] adapted code has license and source notices;
- [ ] visual changes were rendered and inspected.
