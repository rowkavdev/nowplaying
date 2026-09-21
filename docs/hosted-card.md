# Hosted card deployment

`nowplaying` exposes framework-neutral pieces so deployments can choose their own configuration source while keeping provider credentials server-side.

## Wiring

1. Create one provider with a read-only token.
2. Create an artwork cache and the default Sharp sanitizer.
3. Pass those to `createCardPipeline` with the public privacy policy.
4. Wrap the pipeline in `createResilientCardResolver`.
5. Pass the resolver to `createCardHandler`, then pass the handler to `createHttpServer`.

Bind to `127.0.0.1` behind a TLS reverse proxy unless the process is isolated by another trusted network boundary. Never put provider tokens in a card URL.

## Routes

- `GET` or `HEAD /card.svg` returns the SVG card.
- `GET` or `HEAD /healthz` returns `ok` when the HTTP process is responsive.
- Public card options are allowlisted: `theme`, `width`, and comma-separated `show` fields.

Successful cards carry a strong ETag and a short public cache lifetime. Resolver and adapter failures are generic and `no-store`.

## Health checks

Use `/healthz` for the process liveness check. Example container check:

```sh
wget -qO- http://127.0.0.1:3000/healthz | grep -qx ok
```

This proves that the HTTP process can answer, not that the media server is currently reachable. Alert separately on repeated card 503 responses.

## Shutdown

On `SIGTERM` or `SIGINT`, stop accepting traffic and await `app.close()`. The adapter allows active requests to finish, then closes remaining connections at the configured `shutdownMs` bound.
