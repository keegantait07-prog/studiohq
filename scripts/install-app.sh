#!/bin/bash
# Copies the built app to ~/Applications and signs it there. The project folder may live in an
# iCloud-synced location (Desktop/Documents), where macOS keeps adding attributes that break signing.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/release/mac-arm64/Studio HQ.app"
DEST="$HOME/Applications/Studio HQ.app"
[ -d "$SRC" ] || { echo "Build first: npm run dist"; exit 1; }
mkdir -p "$HOME/Applications"
pkill -f "Studio HQ.app/Contents/MacOS" 2>/dev/null || true
rm -rf "$DEST"
ditto --norsrc --noextattr --noqtn "$SRC" "$DEST"
xattr -cr "$DEST"
codesign --force --deep --sign - "$DEST"
codesign -v --deep --strict "$DEST"
echo "Installed: $DEST"
