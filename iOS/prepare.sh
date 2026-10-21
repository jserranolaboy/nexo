#!/bin/bash
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$IOS_ROOT")"
WEB_ROOT="$REPO_ROOT/Web"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
for dir in /opt/homebrew/bin "$HOME/.homebrew/bin" /usr/local/bin; do
  if [[ -d "$dir" ]]; then export PATH="$PATH:$dir"; fi
done
command -v node >/dev/null || { echo "Node is required. Install it separately before building." >&2; exit 1; }
PNPM_BIN="$(command -v pnpm || true)"
[[ -n "$PNPM_BIN" ]] || { echo "pnpm is required. Install it separately before building." >&2; exit 1; }
node "$REPO_ROOT/scripts/sync-locales.mjs" --check
web_stage=$(mktemp -d "${TMPDIR:-/tmp/}nexo-ios-web.XXXXXXXX")
trap 'rm -rf "$web_stage"' EXIT
rsync -a --exclude node_modules --exclude dist --exclude Native --exclude iOS --exclude Design --exclude .git "$WEB_ROOT/" "$web_stage/"
(cd "$web_stage" && "$PNPM_BIN" install --frozen-lockfile && "$PNPM_BIN" build)
mkdir -p "$WEB_ROOT/dist"
rsync -a --delete "$web_stage/dist/" "$WEB_ROOT/dist/"
mkdir -p "$IOS_ROOT/Resources/Web"
rsync -a --delete "$WEB_ROOT/dist/" "$IOS_ROOT/Resources/Web/"
swift "$IOS_ROOT/make-icon.swift" "$IOS_ROOT/Resources/Assets.xcassets/AppIcon.appiconset"
# Updating web assets must preserve the project's existing signing settings.
if [[ ! -d "$IOS_ROOT/Nexo.xcodeproj" || "${1:-}" == "--generate-project" ]]; then
  if command -v xcodegen >/dev/null; then
    xcodegen generate --spec "$IOS_ROOT/project.yml"
  else
    /opt/homebrew/bin/xcodegen generate --spec "$IOS_ROOT/project.yml"
  fi
fi
