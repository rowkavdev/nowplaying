# Updates

The updater is dependency-free and supports private GitHub releases.

## Policy

- `off`: never contact GitHub.
- `notify` (default): check and report an available update without changing files.
- `install`: download, verify and atomically install the update.

Choose `stable` or `beta` explicitly. Channels never cross. Private repositories require a GitHub token with read access; keep it in an environment variable or secret store.

## Safety model

An update is offered only when the release contains both `nowplaying-v<version>.tar.gz` and `SHA256SUMS`. Before install, the archive is size-bounded and its exact SHA-256 entry is verified. The updater stages the archive outside the live install, checks `dist/manifest.json`, then swaps directories atomically. The prior install remains at `<target>.backup` for rollback. A successful install returns `restartRequired: true`; the process manager should restart the service.

```js
import { createAutoUpdater } from "nowplaying";

const updater = createAutoUpdater({
  currentVersion: "0.1.0",
  repository: "rowkav09/nowplaying",
  token: process.env.GITHUB_TOKEN,
  targetDir: "/opt/nowplaying",
  channel: "beta",
  mode: "notify",
  onUpdate(update) {
    console.log(`nowplaying ${update.version} is available`);
  },
});

await updater.check();
```

Do not point `targetDir` at a source checkout with uncommitted work. Automatic installation is best for packaged deployments managed by systemd, Docker or another supervisor.
