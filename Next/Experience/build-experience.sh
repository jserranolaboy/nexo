#!/bin/zsh
set -euo pipefail
script_dir=${0:A:h}
scratch_dir=${VALENTINA_BUILD_DIR:-/tmp/valentina-experience-release}
output_dir=${VALENTINA_APP_DIR:-$HOME/Applications}
staging_dir=$(mktemp -d "${TMPDIR:-/tmp/}valentina-experience.XXXXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
# Node and pnpm come from the system (Homebrew or a version manager).
for dir in /opt/homebrew/bin "$HOME/.homebrew/bin" /usr/local/bin; do
    if [[ -d "$dir" ]]; then export PATH="$PATH:$dir"; fi
done
if ! command -v node >/dev/null; then
    print -u2 -- "Falta Node. Instálalo con: brew install node"
    exit 1
fi
if ! command -v pnpm >/dev/null; then
    if command -v corepack >/dev/null; then corepack enable pnpm; fi
    command -v pnpm >/dev/null || { print -u2 -- "Falta pnpm. Instálalo con: brew install pnpm"; exit 1; }
fi
node "$script_dir/scripts/sync-locales.mjs" --check
# Build in an isolated staging directory so previous dependency installations
# cannot leak stale assets into the delivered application.
web_stage="$staging_dir/frontend"
mkdir -p "$web_stage"
rsync -a --exclude node_modules --exclude dist --exclude Native --exclude iOS --exclude Design --exclude .git "$script_dir/" "$web_stage/"
# Run from the project folder so corepack reads "packageManager" (pnpm 11.19.0).
(cd "$web_stage" && pnpm install --frozen-lockfile && pnpm build)
swift build --package-path "$script_dir/Native" --scratch-path "$scratch_dir" -c release --arch arm64 --arch x86_64 -j 2
executable_dir=$(swift build --package-path "$script_dir/Native" --scratch-path "$scratch_dir" -c release --arch arm64 --arch x86_64 --show-bin-path)
app="$staging_dir/Nexo.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
ditto "$script_dir/Native/Info.plist" "$app/Contents/Info.plist"
ditto "$executable_dir/ValentinaExperience" "$app/Contents/MacOS/ValentinaExperience"
ditto "$web_stage/dist" "$app/Contents/Resources/Web"
ditto "$script_dir/iOS/Resources/PrivacyInfo.xcprivacy" "$app/Contents/Resources/PrivacyInfo.xcprivacy"
swift "$script_dir/scripts/make-icon.swift" "$staging_dir/Nexo.iconset"
iconutil -c icns "$staging_dir/Nexo.iconset" -o "$app/Contents/Resources/Nexo.icns"
oauth_config=${NEXO_GOOGLE_CONFIG:-$HOME/Library/Application Support/Valentina-Experience/GoogleOAuth.json}
if [[ -f "$oauth_config" ]]; then
    # Desktop OAuth client configuration is portable; user tokens remain in Keychain.
    ditto "$oauth_config" "$app/Contents/Resources/GoogleOAuth.json"
fi
codesign --force --sign "${NEXO_SIGN_IDENTITY:--}" "$app"
codesign --verify --deep --strict "$app"
mkdir -p "$output_dir"
# A running WKWebView can still request assets from its bundle. Replacing that
# bundle in place leaves it with a mixture of old and new resources.
if /bin/ps -axo comm= | /usr/bin/awk -v app_path="$output_dir/Nexo.app/Contents/MacOS/ValentinaExperience" '$0 == app_path { found = 1 } END { exit !found }'; then
    print -u2 -- "Cierra Nexo antes de instalar la actualización y vuelve a ejecutar este script. La instalación actual se conserva."
    exit 1
fi
# Real data is never touched by an install, and this proves it: copy the data
# folder first, then compare the main file after replacing the app.
data_dir="$HOME/Library/Application Support/Valentina-Experience"
data_file="$data_dir/workspace-v1.json"
if [[ -f "$data_file" ]]; then
    data_backup="$HOME/Library/Application Support/Nexo-DataBackups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$data_backup"
    ditto "$data_file" "$data_backup/workspace-v1.json"
    print -r -- "Copia de datos: $data_backup"
fi
if [[ -e "$output_dir/Nexo.app" ]]; then
    backup_dir="$HOME/Library/Application Support/Nexo-AppBuilds"
    mkdir -p "$backup_dir"
    mv "$output_dir/Nexo.app" "$backup_dir/Nexo.previous-$(date +%Y%m%d%H%M%S)-$$.app"
fi
mv "$app" "$output_dir/Nexo.app"
if [[ -n "${data_backup:-}" ]]; then
    if cmp -s "$data_file" "$data_backup/workspace-v1.json"; then
        print -r -- "Datos intactos (cmp)"
    else
        print -u2 -- "Los datos cambiaron durante la instalación. La copia está en $data_backup"
        exit 1
    fi
fi
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$output_dir/Nexo.app/Contents/Info.plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$output_dir/Nexo.app/Contents/Info.plist")
print -r -- "Instalado: $output_dir/Nexo.app · $version ($build)"
