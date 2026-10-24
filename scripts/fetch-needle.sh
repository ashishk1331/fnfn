#!/usr/bin/env bash
# Fetch the prebuilt Cactus Whistle engine and weights into vendor/needle.
# Override the location with CACTUS_CLI and CACTUS_MODEL instead if you
# already have them somewhere else.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/vendor/needle"
base="https://huggingface.co/Cactus-Compute"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) platform=linux-x86_64 ;;
  Linux/aarch64 | Linux/arm64) platform=linux-arm64 ;;
  Linux/armv7l) platform=linux-armv7 ;;
  Linux/riscv64) platform=linux-riscv64 ;;
  Darwin/arm64) platform=macos-arm64 ;;
  *)
    echo "No prebuilt Cactus engine for $(uname -s)/$(uname -m)." >&2
    echo "Set CACTUS_CLI and CACTUS_MODEL to a build from another source." >&2
    exit 1
    ;;
esac

mkdir -p "$dest/$platform"

echo "Fetching the $platform engine"
curl -fL --progress-bar -o "$dest/$platform/needle" \
  "$base/needle3/resolve/main/$platform/needle"
chmod +x "$dest/$platform/needle"

if [ -f "$dest/whistle.cact" ]; then
  echo "Using the existing $dest/whistle.cact"
else
  echo "Fetching whistle.cact (16.9 MB)"
  curl -fL --progress-bar -o "$dest/whistle.cact" \
    "$base/whistle/resolve/main/whistle.cact"
fi

echo "Ready: $dest"
