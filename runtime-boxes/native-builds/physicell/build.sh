#!/usr/bin/env bash
# Builds the PhysiCell executable the physicell box ships, from the reviewed 1.14.2 release source.
#
# Reproducible by construction: the toolchain is the one pixi.lock pins (conda-forge GCC with a glibc
# 2.17 sysroot), installed afresh under a temporary path for every build; the flags are fixed; the
# GCC runtime and OpenMP are linked in; and the RPATH conda-forge's compiler would write is never
# written. Two builds therefore give the same bytes wherever they run, and the executable needs
# nothing but glibc 2.17 or newer.
#
# Usage: build.sh <PhysiCell_V.1.14.2.zip> <output directory>
set -euo pipefail
SOURCE_SHA256=15b190ac3420683b1f8e9d61dd9573b7afe0f6bc4c0011b0b0756693ccd0b9f4
EXECUTABLE=physicell-1.14.2-template-linux-x86_64
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

fail() { echo "$*" >&2; exit 1; }

if [ -z "${PHYSICELL_BUILD_WORK:-}" ]; then
  [ $# -eq 2 ] || fail "usage: $0 <PhysiCell_V.1.14.2.zip> <output directory>"
  [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$SOURCE_SHA256" ] || fail "The source is not the reviewed PhysiCell 1.14.2 release."
  ZIP=$(realpath "$1"); OUT=$(realpath -m "$2")
  WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
  mkdir -p "$WORK/toolchain" "$OUT"
  cp "$HERE/pixi.toml" "$HERE/pixi.lock" "$WORK/toolchain/"
  PHYSICELL_BUILD_WORK="$WORK" "${PIXI:-pixi}" run --frozen --manifest-path "$WORK/toolchain/pixi.toml" \
    bash "${BASH_SOURCE[0]}" "$ZIP" "$OUT"
  exit
fi

ZIP=$1; OUT=$2; WORK=$PHYSICELL_BUILD_WORK
TOOL="$CONDA_PREFIX/bin/x86_64-conda-linux-gnu"
python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ZIP" "$WORK/source"
cd "$WORK/source/PhysiCell"
make template > /dev/null
# pixi runs no compiler activation script, so the compiler is named by path. x86-64-v2 instead of
# PhysiCell's -march=native, and without its -mfpmath=both: plain SSE double arithmetic.
FLAGS="-march=x86-64-v2 -O3 -fomit-frame-pointer -m64 -std=c++11"
# PhysiCell's Makefile ignores failing commands, so its log is read as well.
make -j2 CC="$TOOL-g++" CFLAGS="$FLAGS -fopenmp" > build.log 2>&1 || true
if grep -qE "error:|Error [0-9]+" build.log; then grep -E "error:|Error [0-9]+" build.log >&2; fail "PhysiCell did not compile."; fi
"$TOOL-g++" $FLAGS -fopenmp -c main.cpp -o main.o
# conda-forge's compiler writes its own library directory into every dynamic executable as RPATH,
# and removing the entry afterwards would leave the path in the string table. A copy of its specs
# without that clause links without it.
sed -E 's#%\{!static:-rpath [^}]*\}##' "$("$TOOL-g++" -print-file-name=conda.specs)" > "$WORK/norpath.specs"
grep -q -- '-rpath ' "$WORK/norpath.specs" && fail "The compiler specs still add an RPATH."
"$TOOL-g++" $FLAGS -specs="$WORK/norpath.specs" -static-libstdc++ -static-libgcc -o physicell $(ls *.o) \
  -Wl,--push-state,-Bstatic -l:libgomp.a -Wl,--pop-state -lpthread -ldl
"$TOOL-strip" --strip-all physicell

# What the box relies on, checked rather than assumed.
newest=$("$TOOL-objdump" -T physicell | grep -o 'GLIBC_[0-9.]*' | sort -V -u | tail -1)
[ "$(printf '%s\nGLIBC_2.17\n' "$newest" | sort -V | tail -1)" = GLIBC_2.17 ] || fail "Needs $newest, newer than glibc 2.17."
needed=$("$TOOL-readelf" -d physicell | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p' | sort | tr '\n' ' ')
[ "$needed" = "ld-linux-x86-64.so.2 libc.so.6 libdl.so.2 libm.so.6 libpthread.so.0 " ] || fail "Links more than glibc: $needed"
"$TOOL-readelf" -d physicell | grep -qE 'RPATH|RUNPATH' && fail "An RPATH survived."
grep -qaF -e "$CONDA_PREFIX" -e "$WORK" physicell && fail "A build path is recorded in the executable."
install -m 0755 physicell "$OUT/$EXECUTABLE"
echo "$EXECUTABLE $(stat -c %s "$OUT/$EXECUTABLE") bytes, sha256 $(sha256sum "$OUT/$EXECUTABLE" | cut -d' ' -f1), needs $newest"
