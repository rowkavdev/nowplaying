#!/usr/bin/env bash
# Inspect trusted build input without running it. Native packages declare
# only glibc and the standard C++ runtime, so no other shared libraries may
# be required by the bundled Node executable.
set -euo pipefail
runtime="${1:?Node binary required}"
command -v readelf >/dev/null || { echo 'Linux runtime validation needs readelf (binutils).' >&2; exit 2; }
[[ -f "$runtime" && -x "$runtime" ]] || { echo 'Selected Node runtime must be an executable file.' >&2; exit 2; }
if ! dynamic="$(LC_ALL=C readelf --dynamic "$runtime" 2>/dev/null)"; then
  echo 'Selected Linux Node runtime must be an ELF executable, not a shell wrapper.' >&2
  exit 2
fi
while IFS= read -r dependency; do
  case "$dependency" in
    libc.so.6|libm.so.6|libdl.so.2|librt.so.1|libpthread.so.0|libresolv.so.2|libutil.so.1|libanl.so.1|libstdc++.so.6|libgcc_s.so.1|ld-linux-x86-64.so.2|ld-linux-aarch64.so.1) ;;
    *)
      printf 'Selected Node runtime requires unsupported shared library %s.\n' "$dependency" >&2
      echo 'Use an official standalone Node Linux binary: NOWPLAYING_NODE_BINARY=/path/to/node bash scripts/build-posix.sh linux. No runtime is downloaded automatically.' >&2
      exit 2
      ;;
  esac
done < <(printf '%s\n' "$dynamic" | sed -n 's/.*(NEEDED).*Shared library: \[\([^]]*\)\].*/\1/p')
