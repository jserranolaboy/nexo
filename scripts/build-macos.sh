#!/bin/zsh
set -euo pipefail
repo_dir=${0:A:h:h}
scratch_dir=${NEXO_BUILD_DIR:-${VALENTINA_BUILD_DIR:-/tmp/nexo-macos-release}}
output_dir=${NEXO_APP_DIR:-${VALENTINA_APP_DIR:-$HOME/Applications}}
staging_dir=$(mktemp -d "${TMPDIR:-/tmp/}nexo-macos.XXXXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
for dir in /opt/homebrew/bin "$HOME/.homebrew/bin" /usr/local/bin; do
    if [[ -d "$dir" ]]; then export PATH="$PATH:$dir"; fi
done
command -v node >/dev/null || { print -u2 -- "Node is required. Install it separately before building."; exit 1; }
command -v pnpm >/dev/null || { print -u2 -- "pnpm is required. Install it separately before building."; exit 1; }
node "$repo_dir/scripts/sync-locales.mjs" --check
# Isolate dependency installation and generated web assets from the checkout.
web_stage="$staging_dir/frontend"
mkdir -p "$web_stage"
rsync -a --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' --exclude .git "$repo_dir/Web/" "$web_stage/"
(cd "$web_stage" && pnpm install --frozen-lockfile && pnpm build)
swift build --package-path "$repo_dir/Native" --scratch-path "$scratch_dir" -c release --arch arm64 --arch x86_64 -j 2
executable_dir=$(swift build --package-path "$repo_dir/Native" --scratch-path "$scratch_dir" -c release --arch arm64 --arch x86_64 --show-bin-path)
app="$staging_dir/Nexo.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
ditto "$repo_dir/Native/Info.plist" "$app/Contents/Info.plist"
ditto "$executable_dir/Nexo" "$app/Contents/MacOS/Nexo"
ditto "$web_stage/dist" "$app/Contents/Resources/Web"
ditto "$repo_dir/iOS/Resources/PrivacyInfo.xcprivacy" "$app/Contents/Resources/PrivacyInfo.xcprivacy"
swift "$repo_dir/scripts/make-icon.swift" "$staging_dir/Nexo.iconset"
iconutil -c icns "$staging_dir/Nexo.iconset" -o "$app/Contents/Resources/Nexo.icns"
# Optional configuration is included only when the builder explicitly supplies it.
# User tokens remain in Keychain and must never be packaged.
if [[ -n "${NEXO_GOOGLE_CONFIG:-}" ]]; then
    [[ -f "$NEXO_GOOGLE_CONFIG" ]] || { print -u2 -- "NEXO_GOOGLE_CONFIG does not point to a file."; exit 1; }
    ditto "$NEXO_GOOGLE_CONFIG" "$app/Contents/Resources/GoogleOAuth.json"
fi
codesign --force --sign "${NEXO_SIGN_IDENTITY:--}" "$app"
codesign --verify --deep --strict "$app"
mkdir -p "$output_dir"
# Recognize both the current executable and the previous client's executable.
if /bin/ps -axo comm= | /usr/bin/awk -v current="$output_dir/Nexo.app/Contents/MacOS/Nexo" -v previous="$output_dir/Nexo.app/Contents/MacOS/ValentinaExperience" '$0 == current || $0 == previous { found = 1 } END { exit !found }'; then
    print -u2 -- "Close Nexo before installing. The existing installation has been preserved."
    exit 1
fi
# Persistent paths remain compatible with existing Nexo data.
data_dir="$HOME/Library/Application Support/Valentina-Experience"
data_file="$data_dir/workspace-v1.json"
if [[ -f "$data_file" ]]; then
    data_backup="$HOME/Library/Application Support/Nexo-DataBackups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$data_backup"
    ditto "$data_file" "$data_backup/workspace-v1.json"
    print -r -- "Data backup: $data_backup"
fi
if [[ -e "$output_dir/Nexo.app" ]]; then
    backup_dir="$HOME/Library/Application Support/Nexo-AppBuilds"
    mkdir -p "$backup_dir"
    mv "$output_dir/Nexo.app" "$backup_dir/Nexo.previous-$(date +%Y%m%d%H%M%S)-$$.app"
fi
mv "$app" "$output_dir/Nexo.app"
if [[ -n "${data_backup:-}" ]]; then
    if cmp -s "$data_file" "$data_backup/workspace-v1.json"; then
        print -r -- "Primary data unchanged (cmp)."
    else
        print -u2 -- "Data changed during installation. The backup is at $data_backup"
        exit 1
    fi
fi
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$output_dir/Nexo.app/Contents/Info.plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$output_dir/Nexo.app/Contents/Info.plist")
print -r -- "Installed: $output_dir/Nexo.app · $version ($build)"
