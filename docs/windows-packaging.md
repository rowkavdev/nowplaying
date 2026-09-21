# Windows executable packaging

The supported Windows download is a portable ZIP with `nowplaying.exe` as its entry point. The archive also contains the pinned Node runtime, application files and Sharp's Windows native libraries. Keep the files together when extracting the archive.

## Why the native files stay beside the EXE

Artwork sanitization uses Sharp, which includes platform-specific native `.node` and libvips files. Node's single-executable VFS cannot load native addons directly because `process.dlopen()` needs a real filesystem path. Bun's compiled executable path does not yet reliably embed Sharp, and nexe also requires native modules beside its executable.

The portable bundle is therefore the reliable beta format: users launch an EXE, no separate Node installation is required, and artwork keeps working. Release CI builds and smoke-tests it on Windows rather than cross-compiling an untested artifact.

## Future single-file mode

A true one-file build would need to extract the exact Sharp native files into a versioned, integrity-checked cache before loading them. Treat that as experimental until Windows tests cover first run, upgrades, cleanup, locked files and rollback. Do not remove the portable bundle when adding it.

## References

- [Node single executable applications](https://nodejs.org/api/single-executable-applications.html#native-addon-limitations)
- [Sharp installation](https://sharp.pixelplumbing.com/install/)
- [Bun compiled executable documentation](https://bun.sh/docs/bundler/executables)
- [nexe native modules](https://github.com/nexe/nexe#native-modules)
