#!/usr/bin/env bash
# Links this repo's TrenchBroom game config into TrenchBroom's user games directory.
# Then in TrenchBroom: Preferences → Games → "Neon" → Game Path = <repo>/trenchbroom
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
dest="$HOME/.TrenchBroom/games/Neon"
mkdir -p "$HOME/.TrenchBroom/games"
if [ -e "$dest" ] && [ ! -L "$dest" ]; then
  echo "$dest exists and is not a symlink; remove it first" >&2
  exit 1
fi
ln -sfn "$repo/trenchbroom/config" "$dest"
echo "Linked $dest -> $repo/trenchbroom/config"
echo "Now set TrenchBroom → Preferences → Games → Neon → Game Path to: $repo/trenchbroom"
