# Updates

The updater is dependency-free and supports private GitHub releases.

## Policy

- `off`: never contact GitHub.
- `notify` (default): check and report an available update without changing files.
- `install`: download, verify and atomically install the update.

Choose `stable` or `beta` explicitly: there is no default, and the updater refuses to start without one unless the policy is `off`. Channels never cross, and the updater never offers a version lower than or equal to the one installed, so it cannot downgrade. Private repositories require a GitHub token with read access; keep it in an environment variable or secret store.

## Safety model

An update is offered only when the release contains `SHA256SUMS` and the asset for this platform: `nowplaying-v<version>-windows-x64.zip` (the Windows bundle) on Windows, `nowplaying-v<version>.tar.gz` elsewhere. A Windows install never falls back to the tarball. Before install, the archive is size-bounded and its exact SHA-256 entry is verified. The updater stages the archive outside the live install and checks it (on Windows: `app/build-info.json` names the verified version and `nowplaying.exe`, `runtime/node.exe` and `app/package.json` are present; elsewhere: `dist/manifest.json`), then swaps directories atomically. The prior install remains at `<target>.backup` for rollback. A successful install returns `restartRequired: true`; the process manager should restart the service.

```js
import { createAutoUpdater } from "nowplaying";

const updater = createAutoUpdater({
  currentVersion: "0.1.0",
  repository: "rowkavdev/nowplaying",
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

The desktop app doesn't run the updater yet; a later release wires it into the settings page. Until then, install a newer version by running its installer.
