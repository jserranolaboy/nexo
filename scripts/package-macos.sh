#!/bin/bash
# Build/verify an ad-hoc DMG on a fresh hosted Mac. Never installs or launches Nexo.
set -euo pipefail
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 1 ]] || fail 'Usage: package-macos.sh "$RUNNER_TEMP/nexo-package" (must not exist)'
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == macOS ]] || fail 'A fresh standard GitHub-hosted Mac is required'
[[ $(uname -s) == Darwin ]] || fail 'macOS is required'
[[ -n ${RUNNER_TEMP:-} && -d $RUNNER_TEMP ]] || fail 'RUNNER_TEMP is required'
[[ ${DEVELOPER_DIR:-} == /Applications/Xcode_16.4.app/Contents/Developer && -d $DEVELOPER_DIR ]] || fail 'Reviewed Xcode 16.4 is required'
root=$(cd "$(dirname "$0")/.." && pwd -P)
helper="$root/scripts/package-macos-validation.py"
[[ -f $helper ]] || fail 'Packaging validator is missing'
[[ $(git -C "$root" rev-parse --show-toplevel) == "$root" ]] || fail 'Run from the committed checkout'
[[ -z $(git -C "$root" status --porcelain --untracked-files=normal) ]] || fail 'Source must be clean (ignored build output is allowed)'
commit=$(git -C "$root" rev-parse HEAD)
output=$1
work=$(python3 "$helper" initialize "$RUNNER_TEMP" "$output")
mounted=0
run_bounded() { python3 "$helper" run "$@"; }
# Query only our unique image; never detach by a guessed disk number or process name.
detach_owned() {
    [[ $mounted == 1 ]] || return 0
    local device attempt
    for attempt in 1 2 3; do
        run_bounded 30 /usr/bin/hdiutil info -plist > "$work/current-images.plist" || return 1
        device=$(python3 "$helper" device "$work/current-images.plist" "$dmg" "$work/mount") || return 1
        if [[ -z $device ]]; then mounted=0; return 0; fi
        run_bounded 30 /usr/bin/hdiutil detach "$device" || true
        sleep 1
    done
    run_bounded 30 /usr/bin/hdiutil info -plist > "$work/current-images.plist" || return 1
    device=$(python3 "$helper" device "$work/current-images.plist" "$dmg" "$work/mount") || return 1
    [[ -z $device ]] || return 1
    mounted=0
}
cleanup() {
    local result=$?
    trap - EXIT INT TERM
    if ! detach_owned; then
        printf 'Owned DMG cleanup failed; retained scratch: %s\n' "$work" >&2
        exit 1
    fi
    if ! python3 "$helper" cleanup-work "$RUNNER_TEMP" "$work"; then result=1; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$work/source"
git -C "$root" archive "$commit" | tar -x -C "$work/source"
source="$work/source"
helper="$source/scripts/package-macos-validation.py"
# All ignored/untracked credentials and data are excluded by the committed-source archive.
python3 "$helper" metadata "$source" "$commit" "$work/source-info.json"
version=$(python3 "$helper" get "$work/source-info.json" version)
build=$(python3 "$helper" get "$work/source-info.json" build)
pnpm_version=$(python3 "$helper" get "$work/source-info.json" pnpmVersion)
[[ $(node --version) == v24.22.1 ]] || fail 'Reviewed Node 24.22.1 is required'
export COREPACK_HOME="$work/corepack" COREPACK_DEFAULT_TO_LATEST=0
export XDG_CACHE_HOME="$work/cache" XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data"
export npm_config_cache="$work/npm-cache" npm_config_userconfig="$work/empty-npmrc"
: > "$work/empty-npmrc"
export NEXO_LIVE_DRIVE_TEST=0
node "$source/scripts/sync-locales.mjs" --check
(
    cd "$source/Web"
    [[ $(corepack pnpm --version) == "$pnpm_version" ]] || fail 'Pinned pnpm version mismatch'
    corepack pnpm install --frozen-lockfile --store-dir "$work/pnpm-store"
    corepack pnpm build
)
xcrun swift build --package-path "$source/Native" --scratch-path "$work/native-build" --cache-path "$work/swift-cache" --config-path "$work/swift-config" --security-path "$work/swift-security" -c release --arch arm64 --arch x86_64 -j 2
bin_dir=$(xcrun swift build --package-path "$source/Native" --scratch-path "$work/native-build" --cache-path "$work/swift-cache" --config-path "$work/swift-config" --security-path "$work/swift-security" -c release --arch arm64 --arch x86_64 --show-bin-path)
app="$work/image/Nexo.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
/usr/bin/ditto "$source/Native/Info.plist" "$app/Contents/Info.plist"
/usr/bin/ditto "$bin_dir/Nexo" "$app/Contents/MacOS/Nexo"
/usr/bin/ditto "$source/Web/dist" "$app/Contents/Resources/Web"
/usr/bin/ditto "$source/iOS/Resources/PrivacyInfo.xcprivacy" "$app/Contents/Resources/PrivacyInfo.xcprivacy"
/usr/bin/ditto "$source/LICENSE" "$app/Contents/Resources/LICENSE"
/usr/bin/ditto "$source/Web/public/ThirdPartyNotices.txt" "$app/Contents/Resources/ThirdPartyNotices.txt"
xcrun swift "$source/scripts/make-icon.swift" "$work/Nexo.iconset"
/usr/bin/iconutil -c icns "$work/Nexo.iconset" -o "$app/Contents/Resources/Nexo.icns"
/usr/bin/plutil -lint "$app/Contents/Info.plist" "$app/Contents/Resources/PrivacyInfo.xcprivacy"
xcrun lipo "$app/Contents/MacOS/Nexo" -verify_arch arm64 x86_64
architectures=$(xcrun lipo -archs "$app/Contents/MacOS/Nexo")
[[ $architectures == 'x86_64 arm64' || $architectures == 'arm64 x86_64' ]] || fail 'Unexpected executable architectures'
for architecture in arm64 x86_64; do
    xcrun vtool -arch "$architecture" -show-build "$app/Contents/MacOS/Nexo" > "$work/$architecture-build.txt"
    xcrun otool -arch "$architecture" -L "$app/Contents/MacOS/Nexo" > "$work/$architecture-libraries.txt"
    xcrun otool -arch "$architecture" -l "$app/Contents/MacOS/Nexo" > "$work/$architecture-loads.txt"
    python3 "$helper" binary "$work/$architecture-build.txt" "$work/$architecture-libraries.txt" "$work/$architecture-loads.txt"
done
/usr/bin/ditto "$source/LICENSE" "$work/image/LICENSE"
/usr/bin/ditto "$source/Web/public/ThirdPartyNotices.txt" "$work/image/ThirdPartyNotices.txt"
ln -s /Applications "$work/image/Applications"
# Keep scratch private, but make the distributable app readable by its future owner.
python3 "$helper" normalize-image "$work/image"
# Ad-hoc integrity only: no keychain identity, entitlements change, notarization, or policy override.
# codesign creates _CodeSignature after normalization, so give that new content distributable modes.
(umask 022; run_bounded 30 /usr/bin/codesign --force --sign - --timestamp=none "$app")
run_bounded 30 /usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
run_bounded 30 /usr/bin/codesign -dvv "$app" 2> "$work/signature.txt"
grep -Fx 'Signature=adhoc' "$work/signature.txt" >/dev/null
grep -Fx 'Identifier=org.vrr.valentina.experience' "$work/signature.txt" >/dev/null
python3 "$helper" bundle "$app" "$source"
dmg_name="Nexo-$version-$build-universal.dmg"
dmg="$work/$dmg_name"
run_bounded 180 /usr/bin/hdiutil create -volname "Nexo $version" -fs HFS+ -srcfolder "$work/image" -format UDZO "$dmg"
run_bounded 180 /usr/bin/hdiutil verify "$dmg"
mkdir "$work/mount"
mounted=1 # Even a partially successful attach must be cleaned up by exact image identity.
run_bounded 120 /usr/bin/hdiutil attach "$dmg" -readonly -nobrowse -noautoopen -mountpoint "$work/mount" -plist > "$work/attachment.plist"
run_bounded 30 /usr/bin/hdiutil info -plist > "$work/current-images.plist"
run_bounded 30 /usr/sbin/diskutil info -plist "$work/mount" > "$work/disk-info.plist"
python3 "$helper" mount "$work/current-images.plist" "$dmg" "$work/mount" "$work/disk-info.plist" "$work/image"
run_bounded 30 /usr/bin/codesign --verify --deep --strict --verbose=2 "$work/mount/Nexo.app"
detach_owned || fail 'Failed to remove owned DMG attachment'
[[ $(git -C "$root" rev-parse HEAD) == "$commit" && -z $(git -C "$root" status --porcelain --untracked-files=normal) ]] || fail 'Source changed during packaging'
# Only the three product artifacts are copied to the exclusively created output directory.
python3 "$helper" publish "$work/source-info.json" "$dmg" "$output"
(cd "$output" && /usr/bin/shasum -a 256 -c SHA256SUMS)
printf 'Verified ad-hoc, unnotarized package: %s\n' "$output/$dmg_name"
