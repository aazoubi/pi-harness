#!/usr/bin/env bash
# sync.sh - haelt dieses (oeffentliche, private-Inhalte-only) Repo und ~/.pi/agent synchron, ohne Firmenbezogenes zu pushen.
#
#   ./sync.sh status         zeigt Unterschiede (nur lesen)
#   ./sync.sh push [--yes]   lokal -> Repo: nur Allowlist, mit Firmen-Scan; ohne --yes nur Vorschau
#   ./sync.sh pull           Repo -> lokal: nur fehlende Dateien der Allowlist, nie ueberschreiben, nie settings.json
#
# Sicherheitsnetz: Firmen-Scan ueber .sync.local (lokal). settings.json, auth.json, sessions, trust.json, npm/, bin/ werden nie angefasst.
# Der aktive gh-Account wird nicht umgeschaltet; gepusht wird mit dem Token von SYNC_GH_USER (Standard: aazoubi).
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="${PI_DIR:-$HOME/.pi/agent}"
SYNC_GH_USER="${SYNC_GH_USER:-aazoubi}"
SYNC_EMAIL="${SYNC_EMAIL:-aazoubi@users.noreply.github.com}"
SYNC_NAME="${SYNC_NAME:-Ahmad Azoubi}"

# Nur diese Pfade (relativ zu PI_DIR bzw. zum Repo) werden synchronisiert. Glob erlaubt.
ALLOW=(
  "prompts/*.md"
  "themes/*.json"
  "agents/*.md"
  "extensions/tiles.ts"
  "models-store.json"
)
# Firmen-/Arbeitsbezug steht bewusst NICHT in diesem (oeffentlichen) Skript, sondern in .sync.local (nicht im Git).
# Vorlage: .sync.local.example. Ohne .sync.local wird nichts gepusht.
DENY_REGEX=""; PKG_PATTERN=""
# shellcheck disable=SC1091
[ -f "$REPO/.sync.local" ] && . "$REPO/.sync.local"

expand() { # $1 = Basisverzeichnis -> relative Dateien gemaess ALLOW
  local base="$1" pat f
  shopt -s nullglob
  for pat in "${ALLOW[@]}"; do
    for f in "$base"/$pat; do [ -f "$f" ] && echo "${f#"$base"/}"; done
  done
  shopt -u nullglob
}

union() { { expand "$PI_DIR"; expand "$REPO"; } | sort -u; }

# Verzeichnis eines aktiven Pakets (aus settings.json), leer wenn keins aktiv ist.
pc_dir() {
  local p
  [ -n "$PKG_PATTERN" ] || return 0
  p="$(grep -oE "\"[^\"]*($PKG_PATTERN)\"" "$PI_DIR/settings.json" 2>/dev/null | head -1 | tr -d '"')" || true
  [ -n "$p" ] && (cd "$PI_DIR" && cd "$p" 2>/dev/null && pwd) || true
}
PC="$(pc_dir)"

state() { # $1 = rel -> same|changed|local-only|repo-only|via-package
  local l="$PI_DIR/$1" r="$REPO/$1"
  if [ -f "$l" ] && [ -f "$r" ]; then cmp -s "$l" "$r" && echo same || echo changed
  elif [ -f "$l" ]; then echo local-only
  elif [ -n "$PC" ] && [ -e "$PC/$1" ]; then echo via-package
  else echo repo-only; fi
}

cmd_status() {
  echo "Lokal: $PI_DIR"; echo "Repo:  $REPO"; echo
  local n=0 f s
  while IFS= read -r f; do
    s="$(state "$f")"; [ "$s" = same ] || [ "$s" = via-package ] && continue
    printf '  %-12s %s\n' "$s" "$f"; n=$((n+1))
  done < <(union)
  [ "$n" -eq 0 ] && echo "  alles synchron (Allowlist)."
  [ -n "$PC" ] && { echo; echo "Hinweis: ein aktives Paket liefert gleiche Dateien bereits; sie werden nicht gepullt."; }
  true
}

scan() { # $1 = Datei; bricht bei Treffer ab
  [ -n "$DENY_REGEX" ] || { echo "ABBRUCH: .sync.local fehlt oder DENY_REGEX leer (siehe .sync.local.example)." >&2; return 1; }
  if grep -nEi "$DENY_REGEX" "$1" >/tmp/sync-scan.$$ 2>/dev/null; then
    echo "ABBRUCH: Firmenbezug in $1:" >&2; head -3 /tmp/sync-scan.$$ >&2; rm -f /tmp/sync-scan.$$; return 1
  fi
  rm -f /tmp/sync-scan.$$
}

cmd_push() {
  local yes=0; [ "${1:-}" = "--yes" ] && yes=1
  local f s changed=()
  while IFS= read -r f; do
    s="$(state "$f")"
    case "$s" in local-only|changed) scan "$PI_DIR/$f" || exit 1; changed+=("$f");; esac
  done < <(expand "$PI_DIR")
  if [ "${#changed[@]}" -eq 0 ]; then echo "Nichts zu pushen."; return 0; fi
  echo "Wird ins Repo uebernommen (Scan ok):"; printf '  %s\n' "${changed[@]}"
  if [ "$yes" -ne 1 ]; then echo; echo "Vorschau. Mit './sync.sh push --yes' wirklich committen und pushen."; return 0; fi
  for f in "${changed[@]}"; do mkdir -p "$REPO/$(dirname "$f")"; cp "$PI_DIR/$f" "$REPO/$f"; done
  cd "$REPO"
  git add -- "${changed[@]}"
  git -c user.name="$SYNC_NAME" -c user.email="$SYNC_EMAIL" -c commit.gpgsign=false commit -qm "Sync: ${changed[*]}" || { echo "Kein Commit noetig."; return 0; }
  GH_TOKEN="$(gh auth token -u "$SYNC_GH_USER")" git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin HEAD
}

cmd_pull() {
  cd "$REPO"; git pull -q --ff-only
  local f got=0
  while IFS= read -r f; do
    if [ "$(state "$f")" = repo-only ]; then
      mkdir -p "$PI_DIR/$(dirname "$f")"; cp "$REPO/$f" "$PI_DIR/$f"; echo "geholt: $f"; got=$((got+1))
    fi
  done < <(expand "$REPO")
  echo "Fertig. $got Datei(en) geholt, nichts ueberschrieben."
}

case "${1:-status}" in
  status) cmd_status ;;
  push) shift; cmd_push "${1:-}" ;;
  pull) cmd_pull ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
