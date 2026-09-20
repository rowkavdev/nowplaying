# Deployment

`nowplaying` does not yet ship a production server or Discord runtime. The current build is a library and smoke artifact for development. This guide separates what works now from the deployment shape the project is building toward.

Do not expose a current development instance directly to the internet. See [SECURITY.md](../SECURITY.md) before handling real credentials or activity.

## Current local validation

Requirements:

- Node.js 22 or 24
- network access from the process to the selected media server
- a least-privilege provider credential

```bash
git clone https://github.com/rowkav09/nowplaying.git
cd nowplaying
npm install
npm run check
npm test
npm run build
```

The build creates `dist/` with copied ESM source, a sample SVG and a manifest. It does not start an HTTP server or Discord client.

You can exercise a provider and renderer in a local script:

```js
import { writeFile } from "node:fs/promises";
import { createEmbyProvider, renderCard } from "nowplaying";

const provider = createEmbyProvider({
  baseUrl: process.env.EMBY_URL,
  apiKey: process.env.EMBY_API_KEY,
});

const presence = await provider.getPresence({
  userId: process.env.EMBY_USER_ID,
});

await writeFile("now-playing.svg", renderCard(presence), "utf8");
```

Run it only on a trusted host and keep the generated SVG private until you have checked every displayed field.

## Planned runtime shapes

The project needs two different deployment paths because README cards and Discord have different delivery models.

### README card service

The card path will run as a server-side service:

```text
GitHub image request -> public card endpoint -> cached audience-safe SVG
                                             -> background provider polling
```

The public request must never carry a provider token. Provider access stays in server-side configuration. A deployment should poll upstream on a controlled interval, apply privacy rules, cache the rendered SVG and serve the cache quickly.

The hosted service is not implemented yet. Until it is, generating a local SVG is a development workflow, not a live README integration.

### Discord Rich Presence

Discord Rich Presence will run locally where it can reach both the media server and the user's Discord desktop client:

```text
media server -> local nowplaying process -> Discord local RPC
```

It is not a cloud webhook. Running it on a remote server without an accessible Discord client will not publish a desktop presence. Discord application/client configuration is still to be added.

## Environment design

The final runtime will validate a documented configuration schema. Provider credentials should be supplied through environment variables or a secret store. Example names below are conventions for deployment planning, not a finished CLI contract.

```dotenv
NOWPLAYING_PROVIDER=jellyfin
JELLYFIN_URL=https://jellyfin.example.com
JELLYFIN_API_KEY=replace-in-secret-store
NOWPLAYING_USER=rowan
```

Provider-specific values are documented in [providers.md](providers.md).

Do not commit `.env` files. Add production secrets through the host platform and verify that its preview, logs and diagnostics do not echo values.

## Network boundaries

A safe deployment has explicit network rules:

- permit outbound access to the configured media server;
- permit Discord IPC only for the local Discord output;
- expose only the future card HTTP listener;
- deny public access to diagnostics and configuration;
- use TLS at the public edge and to the media server where possible;
- avoid forwarding raw provider paths, headers or errors to clients.

Self-signed media-server certificates should be trusted through the host's CA store. Do not disable TLS verification in application code.

## Polling and caching

Polling belongs in the runtime, not card requests.

- Start with an interval acceptable to the provider and server owner.
- Deduplicate overlapping polls.
- Apply timeouts and bounded retry with jitter.
- Keep the last good, privacy-filtered presence separately from the last error.
- Do not turn authentication, transport or parse errors into idle state.
- Avoid writing full activity history unless the user explicitly enables it.

The card endpoint should return a cached SVG with appropriate content type and cache headers. It should have a defined stale/error card rather than exposing an exception or upstream body.

Discord updates should be sent only when the formatted activity changes. Clear activity according to configured idle/privacy behavior.

## Process supervision

The runtime should run as an unprivileged user under a supervisor that restarts unexpected exits with backoff. Suitable targets may include a system service, container runtime or managed application platform once the executable exists.

The supervisor should provide:

- startup after network availability;
- restart limits and backoff;
- read-only application files;
- a writable cache directory only when needed;
- environment or mounted-secret injection;
- health and structured log collection;
- graceful termination long enough to clear Discord activity and stop polls.

Do not run the process as root to gain access to a local Discord socket. Configure user/session ownership correctly instead.

## Container guidance

A production container definition is planned but not shipped. When added, it should:

- use a supported Node.js image pinned to a specific version or digest;
- install from the lockfile;
- copy the built artifact rather than development files;
- run as a non-root user;
- have a read-only root filesystem where practical;
- define a health check that does not reveal activity;
- declare only the card-service port;
- omit shells and build tools from the final stage;
- carry AGPL license and NOTICE files.

Discord output usually belongs on the desktop host, not in a remote container. Socket mounting is platform-specific and increases the trust boundary.

## Reverse proxy for the future card service

A reverse proxy should terminate TLS, limit request size and rate, add standard security headers and forward only the public card route. Administrative routes must use separate authentication or a private network.

Do not use a predictable public URL as the only authorization for an unredacted card. The privacy layer should make the card safe even if its URL is shared.

## Logs and monitoring

Log operational facts, not private presence details.

Safe examples:

- provider poll succeeded;
- normalized state changed from playing to paused;
- card cache updated;
- Discord transport connected;
- request failed with an HTTP status and redacted provider name.

Avoid titles, profile names, tokens, upstream URLs, authorization headers and raw response bodies. Metrics should use coarse states and durations without high-cardinality media labels.

Alert on repeated authentication failure, sustained polling failure, stale card age, release checksum failure and crash loops.

## Upgrades and rollback

Versioned deployment begins after issue [#28](https://github.com/rowkav09/nowplaying/issues/28) lands.

The release flow should produce immutable artifacts and checksums. A deployment should:

1. verify the artifact checksum and provenance when available;
2. read release notes for configuration changes;
3. keep the prior binary or image available;
4. validate configuration before replacing the running process;
5. start the new version and check health without exposing activity;
6. roll back if polling or output startup fails.

Never use an unpinned branch archive for production deployment.

## AGPL obligations

`nowplaying` is licensed under AGPL-3.0. If you modify it and let users interact with the modified program over a network, ensure those users can receive the complete corresponding source as required by the license. Preserve [LICENSE](../LICENSE), [NOTICE](../NOTICE) and notices in derived files.

This section is practical project guidance, not legal advice.

## Pre-deployment checklist

Do not publish a deployment until the missing runtime exists and these checks pass:

- [ ] tagged release artifact and checksum are verified;
- [ ] configuration validates before startup;
- [ ] credentials are outside source control and logs;
- [ ] provider token has the least practical access;
- [ ] TLS and network boundaries are in place;
- [ ] privacy policy was tested with real playing, paused and idle states;
- [ ] public card contains no provider URL, identifier or credential;
- [ ] health endpoints contain no activity data;
- [ ] logs are redacted;
- [ ] restart, stale-state and rollback behavior were tested;
- [ ] source-offer and notice obligations are satisfied.
