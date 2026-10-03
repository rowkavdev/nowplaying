# Native Linux desktop packages

The builders consume our own CI's generated x86_64 Node bundle. That input
must be trusted and must not change while packaging runs. Symlink validation
rejects accidental links outside the bundle, then flattens internal links.
It is not a race-safe boundary for an attacker editing the tree concurrently.

Staged directories are 755 and files 644, with only the app launcher, bundled
Node and /usr/bin wrapper executable (755). The desktop entry opens the app
without a terminal; the tray opens the existing loopback WebUI.

Build commands, after `bash scripts/build-posix.sh linux`:

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
