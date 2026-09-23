# Hosted card deployment

`nowplaying` exposes framework-neutral pieces so deployments can choose their own configuration source while keeping provider credentials server-side.

## Wiring

1. Create one provider with a read-only token.
2. Create an artwork cache and the default Sharp sanitizer.
3. Pass those to `createCardPipeline` with the public privacy policy.
4. Wrap the pipeline in `createResilientCardResolver({ resolveCard, diagnostics: true })`. With `diagnostics` on, the stale-card headers below are filled in: `live` or `last-good` source, data age, cache hit/miss and the provider failure class. Each theme/width/show variant keeps its own in-flight render and last-good card.
5. Pass the resolver to `createCardHandler`, then pass the handler to `createHttpServer`.

Bind to `127.0.0.1` behind a TLS reverse proxy unless the process is isolated by another trusted network boundary. Never put provider tokens in a card URL.

## Routes

- `GET` or `HEAD /card.svg` returns the SVG card.
- `GET` or `HEAD /healthz` returns `ok` when the HTTP process is responsive.
- Public card options are allowlisted: `theme`, `width`, and comma-separated `show` fields.

Successful cards carry a strong ETag and a short public cache lifetime. Resolver and adapter failures are generic and `no-store`.

## Diagnosing a stale card

Every card response carries privacy-safe diagnostic headers. They never contain titles, usernames, provider URLs, hosts, tokens or error text.

| Header | Values | Meaning |
| --- | --- | --- |
| `X-Nowplaying-Source` | `live`, `last-good`, `idle`, `unavailable` | Fresh provider data, the last good card after a provider failure, nothing playing, or a 503 with no card to fall back on |
| `X-Nowplaying-Age` | seconds | How old the playback data behind the card is |
| `X-Nowplaying-Cache` | `hit`, `miss` | Whether the rendered card came from the process cache |
| `X-Nowplaying-Provider` | `ok`, `error`, `timeout`, `unauthorized`, `unreachable` | Result of the most recent provider poll |
| `X-Nowplaying-Render-Ms` / `Server-Timing` | milliseconds | Time spent producing this response |

Inspect them directly against your card endpoint, bypassing GitHub:

```sh
curl -sI https://your-nowplaying.example/card.svg | grep -iE 'x-nowplaying|server-timing|etag|cache-control'
```

How to read the result:

- **Fresh headers but the README still looks old** - GitHub's Camo cache is serving an older copy. The origin is fine; wait for the cache to expire.
- **`last-good` with a growing age and a provider value other than `ok`** - the media server is failing and the card is showing the last good render. Check the provider connection.
- **`live` but the age keeps growing** - the provider answers, but polling is not refreshing playback state.
- **`unavailable`** - no card could be rendered and there was nothing to fall back on.

## Health checks

Use `/healthz` for the process liveness check. Example container check:

```sh
wget -qO- http://127.0.0.1:3000/healthz | grep -qx ok
```

This proves that the HTTP process can answer, not that the media server is currently reachable. Alert separately on repeated card 503 responses.

## Shutdown

On `SIGTERM` or `SIGINT`, stop accepting traffic and await `app.close()`. The adapter allows active requests to finish, then closes remaining connections at the configured `shutdownMs` bound.
