# Native Linux desktop packages

For download verification, installation, desktop dependencies and troubleshooting, see [Install on Linux](wiki/Install-on-Linux.md). This page documents contributor packaging.

The builders consume our own CI's generated x86_64 Node bundle. That input
must be trusted and must not change while packaging runs. Symlink validation
rejects accidental links outside the bundle, then flattens internal links.
It is not a race-safe boundary for an attacker editing the tree concurrently.

Staged directories are 755 and files 644, with only the app launcher, bundled
Node and /usr/bin wrapper executable (755). The desktop entry opens the app
without a terminal; the tray opens the existing loopback WebUI.

Build the portable payload with a standalone Node Linux executable. The
builder defaults to `node` on `PATH`; use `NOWPLAYING_NODE_BINARY` to select
an official Node binary when the distribution's Node executable links to
system `libnode`, OpenSSL, zlib, or other libraries. `readelf` from binutils
is required to validate Linux input. Only glibc and the standard C++ runtime
libraries are allowed, matching the native package dependencies. The build
fails before replacing existing output when unsupported dependencies are
found; it does not download a runtime automatically.

```sh
NOWPLAYING_NODE_BINARY=/path/to/official-node/bin/node bash scripts/build-posix.sh linux
```

Use the runtime for the target architecture and the supported Node version
from `package.json`. The packaged launcher smoke test checks that it runs.

Native build commands, after creating that portable payload:

```
bash scripts/build-linux-native.sh deb dist/linux/nowplaying 0.2.1+dev out
bash scripts/build-linux-native.sh rpm dist/linux/nowplaying 0.2.1+dev out
bash scripts/build-linux-native.sh arch dist/linux/nowplaying 0.2.1+dev out
```

Run each builder on its target distro with the corresponding tooling. Arch's
makepkg requires an unprivileged builder. The scripts build files only; they
do not install, publish, enable autostart or cut stable releases. Versions use
letters, digits, dot, plus and dash; RPM/Arch translate dash to underscore.
This slice rejects non-x86_64 hosts and bundles rather than mislabeling them.

## Development release identity

Rolling development packages carry `+dev.<headsha>` in package metadata so
upgrades can identify the commit. POSIX bundles embed the base version, full
commit SHA, build time, development channel and unsigned status. Native package
staging preserves that build identity and marks the installation as `deb`,
`rpm` or `arch`; an extracted bundle reports `portable`. The status API and
diagnostics expose the running build identity. A source checkout reports
`source` without inventing build metadata.

The installed `nowplaying --version` still reports the base app version, not
the package-manager suffix. Use the running status/diagnostics commit alongside
package metadata and the published checksum/attestation for exact identity;
do not infer the commit from the CLI's base version alone.
