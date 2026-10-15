#!/bin/bash
# Builds nothing: copies the built plugin into your user plug-in folders, strips the attributes that
# iCloud-synced folders add (they invalidate code signing), and signs it ad hoc on this Mac.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build/StudioHQBridge_artefacts/Release"
install_one() { # $1 = bundle, $2 = destination folder
  [ -d "$1" ] || { echo "Missing $1. Build first (see plugin/README.md)."; exit 1; }
  mkdir -p "$2"
  local dest="$2/$(basename "$1")"
  rm -rf "$dest"
  ditto --norsrc --noextattr --noqtn "$1" "$dest"
  xattr -cr "$dest"
  codesign --force --deep --sign - "$dest" 2>&1 | tail -1
  codesign -v --deep --strict "$dest"
  echo "Installed: $dest"
}
install_one "$OUT/VST3/Studio HQ Bridge.vst3" "$HOME/Library/Audio/Plug-Ins/VST3"
install_one "$OUT/AU/Studio HQ Bridge.component" "$HOME/Library/Audio/Plug-Ins/Components"
