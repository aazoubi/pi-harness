#!/usr/bin/env bash
# Installer for aazoubi's pi harness (agent config, extensions, agents, prompts, themes).
# Safe to re-run; makes a timestamped backup of anything it would overwrite.
set -euo pipefail

PI_DIR="${PI_DIR:-$HOME/.pi/agent}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"

mkdir -p "$PI_DIR"

link_or_copy() {
  local name="$1"
  local src="$SRC_DIR/$name"
  local dst="$PI_DIR/$name"
  [ -e "$src" ] || return 0

  if [ -e "$dst" ] || [ -L "$dst" ]; then
    echo "Backing up existing $dst -> $dst.bak.$STAMP"
    mv "$dst" "$dst.bak.$STAMP"
  fi

  cp -R "$src" "$dst"
  echo "Installed $name -> $dst"
}

for item in agents extensions prompts themes settings.json mcp.json models-store.json; do
  link_or_copy "$item"
done

echo ""
echo "Done. pi will pick up config from: $PI_DIR"
echo "Note: auth.json (API keys) is NOT part of this repo — run 'pi auth' on this machine to log in."
