# Nexo

**Plan events, understand participation, and coordinate your team in one workspace.**

Nexo connects your organization's calendar with its people, attendance records, volunteer assignments, and event documents. It is designed for associations, volunteer teams, and groups that need to plan activities and keep a clear record of their work.

## From the next event to a complete record

- **Plan with context.** Bring dates, activity components, categories, and participants together in the agenda. Edit or duplicate events and choose which ones count toward attendance.
- **Understand participation.** Open each person's profile and review results by period or activity, with statuses and history that explain the percentage.
- **Coordinate volunteers.** Review suggestions based on previous participation and choose assignments within each event's capacity.
- **Create documents with your own identity.** Design templates from scratch or over an existing PDF, then generate signature sheets or multi-page attendance records.
- **Choose how to collaborate.** Work with local spaces and connect the ones you want to share through Google Drive. Collaboration is optional and preserves alternatives when changes conflict.

## Open source, actively developing

Nexo is **open-source software under the MIT license**. The current source version is **0.4.0 (10)**, located in [`Next/Experience`](Next/Experience/README.md). The experience shares an interface across Mac, iPhone, and iPad, with native storage and document features.

This is a source-code release. Native visual review of the current build, execution on an actual Sequoia Mac, and preparation of a signed/notarized distribution remain pending. Requirements, completed checks, and limitations are detailed below. VRR was the earlier prototype; its releases and cask do not install the current Nexo client and are not included in this snapshot.

## What you can do

| Area | Features |
| --- | --- |
| Events | Agenda, week, and month views; create, edit, duplicate, or cancel activities; choose which count toward attendance. |
| People | Groups, historical memberships, individual profiles, list and table views; results by period, component, and category. |
| Attendance | Build rosters from groups or individuals; pending, present, absent, and excused statuses; notes, removed/restored records, and Undo. Mac also supports keyboard marking. |
| Volunteering | Suggestions ordered by lower previous participation, manual selection, capacity limits, and separate interest, selection, and completion states. |
| Documents | Start with blank paper or a PDF; edit columns, text, and images; retain drafts and export multi-page PDFs for signatures or recorded attendance. |
| Spaces and data | Create and rename spaces, move them to Trash and restore them; export JSON backups, validate imports, and retain earlier revisions. |
| Collaboration | Link a space to Drive, open a shared space, pause or resume changes, and resolve conflicting versions. |

The interface has three areas: **Events**, **People**, and **Documents**, with search, periods, English/Spanish localization, and light, dark, or system appearance. It shares the web experience across Mac, iPhone, and iPad, with platform-specific native containers and features.

Each person's attendance rate is `present / (present + absent)`. Excused and pending records remain visible but do not enter the denominator. Cancelled events, events that do not count, and removed roster entries are also excluded. Someone outside an event's roster does not acquire an absence simply because the event exists.

## Requirements

- **Mac:** configured minimum deployment target macOS 15; development requires full Xcode and a toolchain compatible with Swift 6.1 or later.
- **Web:** a Node version supported by Vite 8 (`^20.19.0 || >=22.12.0`) and pnpm **11.19.0**, pinned in `packageManager`. Run pnpm from `Next/Experience` so the package manager reads that version.
- **iPhone/iPad:** configured minimum deployment target iOS/iPadOS 18. Preparation requires Xcode; XcodeGen is needed when generating or regenerating the project. See the [iOS guide](Next/Experience/iOS/README.md).

Verification for this work used an Apple Silicon Mac with macOS 27.0.1, Swift 6.4, and Node 24.21.0. Deployment targets do not prove execution on Sequoia or every supported device.

## Explore the web interface

From the repository root:

```sh
cd Next/Experience
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5188`. The development view uses synthetic data; it does not run native persistence, native PDF generation, or a live Drive connection. The packaged application includes its interface and does not need this server.

## Build and test

Web tests and build, from `Next/Experience`:

```sh
pnpm test
pnpm build
```

Native tests, from the repository root. Temporary build directories avoid interference from File Provider attributes in the checkout:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Next --scratch-path /tmp/nexo-core-tests -j 2

NEXO_LIVE_DRIVE_TEST=0 \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Next/Experience/Native --scratch-path /tmp/nexo-native-tests -j 2
```

The local suite uses synthetic data and an in-memory Drive transport. The live Drive test is opt-in and requires separate authorization for the account and remote operations; the command above disables it.

To build the universal Mac executable without installing an app:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift build --package-path Next/Experience/Native \
  --scratch-path /tmp/nexo-mac-build -c release --arch arm64 --arch x86_64 -j 2
```

### Prepare the Mac app bundle

```sh
zsh Next/Experience/build-experience.sh
```

This script builds the web and native code, creates `Nexo.app`, and installs it in `~/Applications/Nexo.app`. Close Nexo first: the script retains the previous app and, when present, copies the primary data file and checks that it remains identical. It uses ad-hoc signing unless another identity is explicitly configured; it does not notarize the app. It can also include an existing local OAuth configuration: review the inputs and output before distribution. See [release preparation](RELEASING.md).

## Storage and recovery

| Platform | Primary file |
| --- | --- |
| Mac | `~/Library/Application Support/Valentina-Experience/workspace-v1.json` |
| iPhone/iPad | `Library/Application Support/Nexo/workspace-v1.json`, inside the app container |
| VRR alpha | `~/Library/Application Support/VRR/vrr-data.json`; a different format and implementation |

The internal names `Valentina-Experience` and `VRRCore` remain to preserve continuity. Do not rename data directories or copy VRR's JSON over Nexo's: migration from the alpha requires a specific test using a copy.

`SnapshotStore` checks revisions and relationships, preserves both the previous and new revisions before replacing the primary file, and does not create an empty space over damaged data. On save, it compacts `Backups`: it retains the 60 most recent copies, then one per hour for two days, one per day up to 60 days, and one per week for older copies. Drive's causal history is not yet compacted.

Exported backups include spaces, relationships, attendance, volunteering, and saved templates with their PDFs and images. New backups add a SHA-256 checksum to detect changes; this is not encryption. Template drafts are stored separately. Importing a backup validates its contents, preserves the previous file, and pauses Drive. Keep an independent backup outside both the Mac and Drive.

## Google Drive collaboration

Connecting is optional. Each space is linked explicitly; connecting Google does not automatically upload every local space. The owner shares the folder in Drive and controls its permissions; Nexo does not send invitations automatically.

Edits are saved locally with their pending queue. Synchronization sends changes and preserves alternatives when it detects concurrent edits. An imported backup retains history, conflicts, and pending changes, but requires a deliberate action to resume Drive.

On Mac, OAuth uses an external browser and PKCE; tokens stay in Keychain and are not passed to the interface. The current integration requests the `drive` scope. The documented development configuration is in testing mode; account access, the Picker/`drive.file` alternative, and verification requirements must be reviewed before distribution. [Details and limitations](Next/Experience/README.md#collaborating-through-google-drive).

Drive does not replace an independent backup. The owner can delete remote files; a new device may need an exported backup or a restored folder. Zero data loss and continuous remote availability are not guaranteed.

## Architecture

| Path | Responsibility |
| --- | --- |
| `Next/Experience/src` | React 19, TypeScript, and Motion: interface, navigation, and presented state. |
| `Next/Experience/Native/Sources/ValentinaExperience` | AppKit window, WKWebView, bridge, and Mac dialogs. |
| `Next/Experience/Native/Sources/ExperienceKit` | Local operations, backups, drafts, and Drive collaboration. |
| `Next/Sources/VRRCore` | Models, attendance/volunteering rules, recoverable persistence, PDF, and causal history. |
| `Next/Experience/iOS` | UIKit container, iOS integration, and Xcode project. |
| Earlier implementations | The VRR, MacApp, and Service prototypes are not included in this snapshot. The current client does not require a Python server. |

## Verification status

For source `615057e`, **34 core tests, 31 native tests, and 26 web tests** passed on October 21, 2026; the opt-in live Drive test was skipped. A universal Mac build with local signing also completed in an isolated QA copy.

Native visual review remained pending because the Mac control transport failed. The reference installed app reports 0.4.0 (10), but its five web assets match a build of the parent of `615057e`; it lacks the latest fix for invisible content when WebKit defers animations. The same version number does not identify an exact build.

Execution on an actual Sequoia Mac, review of this build in WebKit and on physical devices, collaboration between two Macs using different accounts, a validated migration from VRR, and distribution signing remain pending. Historical records of other checks do not mean they were repeated against this build.

## Documentation

- [Current client guide](Next/Experience/README.md) · [iPhone and iPad](Next/Experience/iOS/README.md)
- [Contributing](CONTRIBUTING.md) · [Security boundaries and reporting](SECURITY.md)
- [Release preparation](RELEASING.md) · [Snapshot scope](docs/PUBLICATION_REVIEW.md)
- [Optional integrations and dependencies](docs/INTEGRATIONS.md)
- [MIT-licensed code](LICENSE) · [Third-party notices](Next/Experience/public/ThirdPartyNotices.txt)

This snapshot comes from Nexo source `615057e`; its technical provenance is recorded in `SOURCE_ORIGIN.txt`. It excludes the previous Git history, user data, private OAuth configuration, and alpha packages. Source availability does not constitute an installable release or notarization.
