# Nexo for iPhone and iPad

UIKit container for the same Nexo React interface, with native persistence and PDF generation. Configured minimum deployment target: iOS/iPadOS 18; development source version 0.4.1 (11), unreleased. This does not prove execution on every device or a TestFlight delivery.

## Prepare and build

From the repository root, with Xcode, Node, pnpm, and XcodeGen available:

```sh
iOS/prepare.sh
open iOS/Nexo.xcodeproj
```

`prepare.sh` builds the web interface with pinned dependencies, copies resources, and generates the icon from code. Run it before opening this snapshot's project, which excludes the generated PNG and compiled Web resources. Regenerate the project with `--generate-project` only when necessary; routine updates preserve local signing settings.

This snapshot contains neither a personal signing team nor OAuth IDs. Choose a simulator for development. For a physical device, the owner configures their team and Apple's requirements locally; this repository does not create credentials or distribute profiles.

## Use without configuring Drive

Spaces, people, the agenda, attendance, volunteering, templates, PDFs, and backups are local client features. GoogleSignIn remains a dependency because collaboration code uses it, but configuring Google or signing in is not required for local spaces. There is no application server to deploy.

To enable Drive, configure the iOS OAuth client and its return URL in your local copy according to GoogleSignIn's requirements. The original development project's `GIDClientID` and `CFBundleURLTypes` were removed from the published `Info.plist`. Do not add tokens, passwords, or sessions to the repository. Cross-account collaboration configuration and validation are separate from building the local client.

## Interaction and storage

Three areas: Events, People, and Documents. On iPhone, an event opens above the agenda; swipe right to return. In attendance, tapping can mark someone present; swipe right for present and left for absent. The profile allows excusing, adding notes, and removing/restoring records; each change offers Undo. Volunteers are selected manually.

On portrait iPad, the agenda and event appear together with bottom tabs; layouts at least 1100 points wide use a sidebar. Details become sheets when there is insufficient width. The editor retains touch controls for columns, text, images, and PDFs.

Data is stored in `Library/Application Support/Nexo/workspace-v1.json` inside the app container. Drafts are stored separately, and JSON backups share the Nexo Mac format. See [storage and limitations](../docs/DEVELOPMENT.md#storage-and-recovery).

The shared suites ran on Mac. After consolidation, generic iOS Simulator compilation and unit-target `build-for-testing` passed with `CODE_SIGNING_ALLOWED=NO`. iOS tests were compiled, not executed. Installation, startup, visual interaction, and physical-device verification remain pending.

To compile without installing or using a signing identity, from the repository root:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project iOS/Nexo.xcodeproj -scheme Nexo \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/nexo-ios-build CODE_SIGNING_ALLOWED=NO build
```
