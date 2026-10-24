#!/bin/bash
# Launch only the verified image's app on a fresh disposable hosted Mac.
set -euo pipefail
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 1 ]] || fail 'Usage: smoke-macos-package.sh "$RUNNER_TEMP/nexo-package"'
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == macOS ]] || fail 'A fresh standard GitHub-hosted Mac is required'
[[ $(uname -s) == Darwin && ${NEXO_LIVE_DRIVE_TEST:-} == 0 ]] || fail 'A Mac with live Drive disabled is required'
[[ ${DEVELOPER_DIR:-} == /Applications/Xcode_16.4.app/Contents/Developer && -d $DEVELOPER_DIR ]] || fail 'Reviewed Xcode 16.4 is required'
root=$(cd "$(dirname "$0")/.." && pwd -P)
helper="$root/scripts/package-macos-validation.py"
output=$(python3 - "$RUNNER_TEMP" "$1" <<'PY'
import os
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve(strict=True)
path = Path(sys.argv[2])
if not path.is_absolute() or path.is_symlink() or path.resolve(strict=True).parent != root or path.stat().st_uid != os.getuid():
    raise SystemExit('Package output must be an owned direct child of RUNNER_TEMP')
print(path.resolve(strict=True))
PY
)
dmg_name=$(python3 "$helper" verify-output "$output")
dmg="$output/$dmg_name"
before=$(/usr/bin/shasum -a 256 "$dmg")
work=$(python3 "$helper" initialize-smoke "$RUNNER_TEMP")
mounted=0
run_bounded() { python3 "$helper" run "$@"; }
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
        printf 'Owned startup image cleanup failed; retained scratch: %s\n' "$work" >&2
        exit 1
    fi
    if ! python3 "$helper" cleanup-work "$RUNNER_TEMP" "$work"; then result=1; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$work/mount"
mounted=1
run_bounded 120 /usr/bin/hdiutil attach "$dmg" -readonly -nobrowse -noautoopen -mountpoint "$work/mount" -plist > "$work/attachment.plist"
run_bounded 30 /usr/bin/hdiutil info -plist > "$work/current-images.plist"
run_bounded 30 /usr/sbin/diskutil info -plist "$work/mount" > "$work/disk-info.plist"
python3 "$helper" readonly-mount "$work/current-images.plist" "$dmg" "$work/mount" "$work/disk-info.plist"
run_bounded 30 /usr/bin/codesign --verify --deep --strict --verbose=2 "$work/mount/Nexo.app"
xcrun swiftc -swift-version 6 -strict-concurrency=complete -parse-as-library "$root/scripts/smoke-macos-app.swift" -o "$work/smoke-macos-app"
"$work/smoke-macos-app" "$work/mount/Nexo.app"
detach_owned || fail 'Failed to detach the owned startup image'
[[ $(/usr/bin/shasum -a 256 "$dmg") == "$before" ]] || fail 'Disk image changed during startup validation'
python3 "$helper" verify-output "$output" >/dev/null
printf 'Readonly packaged-app startup check completed without installing Nexo\n'
