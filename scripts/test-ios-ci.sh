#!/bin/bash
set -euo pipefail

# This installs the unit-test host only in a NEW disposable hosted simulator.
# Never target a user's Mac, existing simulator, physical device, or live account.
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == macOS ]] || {
  echo "This test entry point requires a GitHub-hosted macOS runner." >&2
  exit 1
}
: "${RUNNER_TEMP:?A runner temporary directory is required}"
[[ "${NEXO_LIVE_DRIVE_TEST:-}" == 0 ]] || { echo "Live Drive tests must be disabled." >&2; exit 1; }
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"

state_file="$RUNNER_TEMP/nexo-ios-device-id"
device=''
valid_device() { [[ "$1" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; }
device_present() {
  xcrun simctl list devices --json > "$RUNNER_TEMP/nexo-ios-cleanup-devices.json" || return 1
  node --input-type=module - "$RUNNER_TEMP/nexo-ios-cleanup-devices.json" "$1" <<'JS'
import { readFileSync } from 'node:fs'
const [path, id] = process.argv.slice(2)
const inventory = JSON.parse(readFileSync(path))
console.log(Object.values(inventory.devices).flat().some((device) => device.udid === id))
JS
}
cleanup_device() {
  local owned="$device" present
  if [[ -f "$state_file" ]]; then read -r owned < "$state_file" || return 1; fi
  [[ -n "$owned" ]] || return 0
  valid_device "$owned" || { echo "Refusing an invalid owned simulator ID." >&2; return 1; }
  present=$(device_present "$owned") || return 1
  if [[ "$present" == true ]]; then
    xcrun simctl shutdown "$owned" 2>/dev/null || true
    xcrun simctl delete "$owned" || return 1
  fi
  present=$(device_present "$owned") || return 1
  [[ "$present" == false ]] || { echo "Job-owned simulator still exists: $owned" >&2; return 1; }
  rm -f "$state_file" || return 1
  echo "Verified job-owned simulator removed: $owned"
}
if [[ "${1:-}" == --cleanup && $# == 1 ]]; then cleanup_device; exit; fi
[[ $# == 0 ]] || { echo "Unsupported arguments." >&2; exit 1; }
[[ ! -e "$state_file" ]] || { echo "An owned simulator record already exists; clean it before another run." >&2; exit 1; }

runtime=com.apple.CoreSimulator.SimRuntime.iOS-18-5
device_type=com.apple.CoreSimulator.SimDeviceType.iPhone-16
xcrun simctl list runtimes --json > "$RUNNER_TEMP/nexo-ios-runtimes.json"
xcrun simctl list devicetypes --json > "$RUNNER_TEMP/nexo-ios-device-types.json"
node --input-type=module - "$RUNNER_TEMP" "$runtime" "$device_type" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const [directory, runtimeID, deviceID] = process.argv.slice(2)
const runtimes = JSON.parse(readFileSync(`${directory}/nexo-ios-runtimes.json`)).runtimes
const types = JSON.parse(readFileSync(`${directory}/nexo-ios-device-types.json`)).devicetypes
const runtime = runtimes.find((item) => item.identifier === runtimeID && item.isAvailable)
const device = types.find((item) => item.identifier === deviceID)
assert.ok(runtime, 'Preinstalled iOS 18.5 runtime is unavailable; do not download one automatically')
assert.ok(device, 'Preinstalled iPhone 16 simulator device type is unavailable')
console.log(`Testing ${device.name} with ${runtime.name} (${runtime.buildversion})`)
JS

# Resources are generated from this checkout; the committed Xcode project is preserved.
test -f Web/dist/index.html
node scripts/sync-locales.mjs --check
mkdir -p iOS/Resources/Web
cp -R Web/dist/. iOS/Resources/Web/
xcrun swift iOS/make-icon.swift iOS/Resources/Assets.xcassets/AppIcon.appiconset

cleanup() {
  local status=$?
  trap - EXIT
  if ! cleanup_device; then
    echo "Could not verify removal of the job-owned simulator." >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
device=$(xcrun simctl create 'Nexo CI unit tests' "$device_type" "$runtime")
valid_device "$device" || {
  device=''
  echo "simctl did not return a valid newly created device ID." >&2
  exit 1
}
printf '%s\n' "$device" > "$state_file"
echo "Created job-owned simulator $device"

# NexoTests uses an app test host. It may access ONLY this fresh simulator's empty
# app container/Keychain. No OAuth configuration, provisioning, UI suite, or seed script.
xcodebuild -project iOS/Nexo.xcodeproj -scheme Nexo -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$device" -destination-timeout 120 \
  -derivedDataPath "$RUNNER_TEMP/nexo-ios-tests" \
  -clonedSourcePackagesDirPath "$RUNNER_TEMP/nexo-ios-packages" \
  -onlyUsePackageVersionsFromResolvedFile -disableAutomaticPackageResolution -skipPackageUpdates \
  -parallel-testing-enabled NO -only-testing:NexoTests \
  -skip-testing:NexoTests/LiveDriveTests \
  CODE_SIGNING_ALLOWED=NO test

git diff --exit-code -- iOS/Nexo.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
