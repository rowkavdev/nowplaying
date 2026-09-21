# Aggregate analytics

Analytics is self-hosted and privacy-limited. It stores aggregate counters, not playback histories.

## What is counted

- total successfully generated cards
- distinct card installations
- total Discord usage events
- distinct Discord installations
- distinct installations across both outputs

An installation ID is salted and SHA-256 hashed before persistence. The raw identifier, media title, provider, media-server username, Discord account, IP address and request history are not stored.

## Server configuration

Create a long random `salt` and a separate stats bearer token. Keep both in a secret store. The analytics file is written atomically with owner-only permissions.

`GET /stats` returns aggregate JSON only with `Authorization: Bearer <token>` and always uses `Cache-Control: no-store`.

Card counting wraps the successful card resolver with `withCardAnalytics`. Failed renders are not counted.

## Discord consent

Discord runs locally. Analytics is disabled by default and requires an explicit HTTPS endpoint plus `enabled: true`. The client sends one process-start ping containing only the random installation ID in a header. It sends no presence, media or Discord-account data.

```js
const analytics = createDiscordAnalytics({
  enabled: false,
  endpoint: "https://cards.example.com",
  installationId: process.env.NOWPLAYING_INSTALLATION_ID,
});

await analytics.ping();
```

Self-hosters can leave analytics disabled or point it at their own service. There is no vendor-operated telemetry endpoint in the project.
