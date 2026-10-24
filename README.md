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

Nexo is **open-source software under the MIT license**. The current source version is **0.4.1 (12)**. One shared interface serves Mac, iPhone, and iPad, with native storage and document features. The [experimental Mac preview](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.1-preview.2) is pinned to commit `af263a20e1e4dec2448a1b528ed949a4c9955a60`; later development commits are not automatically included in that download.

VRR was the earlier prototype. Its releases and cask do not install the current Nexo client. Historical source previews remain available, but are separate from the current Nexo disk image and tap.

## Experimental Mac downloads

[Download the universal Mac disk image](https://github.com/jserranolaboy/nexo/releases/download/v0.4.1-preview.2/Nexo-0.4.1-12-universal.dmg) for macOS 15 or later, on Apple Silicon or Intel. The [release page](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.1-preview.2) also provides `SHA256SUMS` and `build-info.json`; verify the downloaded files against them before use.

**This preview is ad-hoc signed, not Developer ID signed or notarized.** Gatekeeper may block the downloaded app. Neither the disk image nor the cask disables those protections; a matching checksum does not establish Gatekeeper approval. End-user installation and replacement of an existing installation are not yet validated.

For manual installation, close Nexo, keep an independent workspace backup, open the disk image and drag `Nexo.app` to Applications. No Google OAuth configuration is bundled.

The [Nexo Homebrew tap](https://github.com/jserranolaboy/homebrew-nexo) offers the same checksum-pinned preview:

```sh
brew install --cask jserranolaboy/nexo/nexo@preview
```

Review the cask and its signing caveat before running the command. The tap does not bypass Gatekeeper or remove workspace data. Its full new-cask audit remains subject to signing and upstream eligibility rules; availability in this tap is not approval for the official Homebrew cask repository. See [release preparation](RELEASING.md#experimental-mac-disk-images) for the distribution boundaries.

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
- **Web:** a Node version supported by Vite 8 (`^20.19.0 || >=22.12.0`) and pnpm **11.19.0**, pinned in `packageManager`. Run pnpm from `Web` so the package manager reads that version.
- **iPhone/iPad:** configured minimum deployment target iOS/iPadOS 18. Preparation requires Xcode; XcodeGen is needed when generating or regenerating the project. See the [iOS guide](iOS/README.md).

Deployment targets and a universal executable do not establish compatibility with every supported device or validate end-user installation.

## Explore the web interface

From the repository root:

```sh
cd Web
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5188`. The development view uses synthetic data; it does not run native persistence, native PDF generation, or a live Drive connection. The packaged application includes its interface and does not need this server.

## Build and test

Web tests and build, from `Web`:

```sh
pnpm test
pnpm build
```

Native tests, from the repository root. Temporary build directories avoid interference from File Provider attributes in the checkout:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Core --scratch-path /tmp/nexo-core-tests -j 2

NEXO_LIVE_DRIVE_TEST=0 \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Native --scratch-path /tmp/nexo-native-tests -j 2
```

The local suite uses synthetic data and an in-memory Drive transport. The live Drive test is opt-in and requires separate authorization for the account and remote operations; the command above disables it.

To build the universal Mac executable without installing an app:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift build --package-path Native \
  --scratch-path /tmp/nexo-mac-build -c release --arch arm64 --arch x86_64 -j 2
```

### Local development app-bundle script

`scripts/build-macos.sh` is a separate development installer, not the disk-image packaging path. Its installation/update behavior is not validated for this preview; do not use its default installation mode for an existing workspace. Prefer the published experimental disk image for distribution.

For development output outside your normal Applications directory:

```sh
NEXO_APP_DIR=/tmp/nexo-app-output NEXO_BUILD_DIR=/tmp/nexo-package-build \
  zsh scripts/build-macos.sh
```

This isolates build outputs only. Opening the app still requires a separate QA environment to isolate runtime storage.

Without explicit output paths, this script builds the web and native code, creates `Nexo.app`, and installs it in `~/Applications/Nexo.app`. Close every Nexo copy that shares your workspace first. The installer stages and verifies the replacement on the destination filesystem, retains the complete previous app beside it as `Nexo.previous-<unique ID>.app`, and attempts rollback if replacement or verification fails. It does not read, copy, or migrate application data. Before an update, separately back up the complete support directory, including drafts and history; see [release preparation](RELEASING.md). It uses ad-hoc signing unless another identity is explicitly configured and does not notarize the app. OAuth configuration is excluded by default; inclusion requires an explicit `NEXO_GOOGLE_CONFIG` path. Review the inputs and output before distribution.

## Storage and recovery

| Platform | Primary file |
| --- | --- |
| Mac | `~/Library/Application Support/Valentina-Experience/workspace-v1.json` |
| iPhone/iPad | `Library/Application Support/Nexo/workspace-v1.json`, inside the app container |
| VRR alpha | `~/Library/Application Support/VRR/vrr-data.json`; a different format and implementation |

Persistent identifiers such as `Valentina-Experience` remain to preserve existing data. Current modules are `NexoCore` and `NexoKit`; see the [compatibility contract](docs/ARCHITECTURE.md). Do not rename data directories or copy VRR's JSON over Nexo's: migration from the alpha requires a specific test using a copy.

`SnapshotStore` checks revisions and relationships, preserves both the previous and new revisions before replacing the primary file, and does not create an empty space over damaged data. On save, it compacts `Backups`: it retains the 60 most recent copies, then one per hour for two days, one per day up to 60 days, and one per week for older copies. Drive's causal history is not yet compacted.

Exported backups include spaces, relationships, attendance, volunteering, and saved templates with their PDFs and images. New backups add a SHA-256 checksum to detect changes; this is not encryption. Template drafts are stored separately. Importing a backup validates its contents, preserves the previous file, and pauses Drive. Keep an independent backup outside both the Mac and Drive.

## Google Drive collaboration

Connecting is optional. Each space is linked explicitly; connecting Google does not automatically upload every local space. The owner shares the folder in Drive and controls its permissions; Nexo does not send invitations automatically.

Edits are saved locally with their pending queue. Synchronization sends changes and preserves alternatives when it detects concurrent edits. An imported backup retains history, conflicts, and pending changes, but requires a deliberate action to resume Drive.

On Mac, OAuth uses an external browser and PKCE; tokens stay in Keychain and are not passed to the interface. The current integration requests the `drive` scope. The documented development configuration is in testing mode; account access, the Picker/`drive.file` alternative, and verification requirements must be reviewed before distribution. [Details and limitations](docs/DEVELOPMENT.md#collaborating-through-google-drive).

Drive does not replace an independent backup. The owner can delete remote files; a new device may need an exported backup or a restored folder. Zero data loss and continuous remote availability are not guaranteed.

## Architecture

One current implementation is organized by responsibility. Earlier prototypes are excluded; no Python server is required.

| Path | Responsibility |
| --- | --- |
| `Web/src` | React 19, TypeScript, and Motion: interface, navigation, and presented state. |
| `Native/Sources/Nexo` | AppKit window, WKWebView, bridge, and Mac dialogs. |
| `Native/Sources/NexoKit` | Local operations, backups, drafts, and Drive collaboration. |
| `Core/Sources/NexoCore` | Models, attendance/volunteering rules, recoverable persistence, PDF, and causal history. |
| `iOS` | UIKit container, iOS integration, and Xcode project. |
| `scripts` | Build, localization, icons, and synthetic simulator tooling. |

## Verification status

The published source preview at `8356404` preserves the original runtime source `615057e`: **34 core tests, 31 native tests, and 26 web tests** passed on October 21, 2026; the opt-in live Drive test was skipped. A universal Mac build with ad-hoc signing also completed in an isolated QA copy.

The development branch adds reliability fixes and a responsibility-based layout. Its exact checks and remaining findings are tracked in [development status](docs/DEVELOPMENT_STATUS.md).

Native visual review remains pending. Identify artifacts by commit and checksum as well as version: older 0.4.0 builds can contain different web resources.

End-user installation/update validation, comprehensive native visual and physical-device review, collaboration between two Macs using different accounts, a validated migration from VRR, and distribution signing remain pending. Historical records of other checks do not mean they were repeated against this build.

## Documentation

- [Architecture and compatibility](docs/ARCHITECTURE.md) · [Development status](docs/DEVELOPMENT_STATUS.md)
- [Current client guide](docs/DEVELOPMENT.md) · [iPhone and iPad](iOS/README.md)
- [Contributing](CONTRIBUTING.md) · [Security boundaries and reporting](SECURITY.md)
- [Release preparation](RELEASING.md) · [Snapshot scope](docs/PUBLICATION_REVIEW.md)
- [Optional integrations and dependencies](docs/INTEGRATIONS.md)
- [MIT-licensed code](LICENSE) · [Third-party notices](Web/public/ThirdPartyNotices.txt)

This project began with the reviewed Nexo source snapshot `615057e`; its technical provenance is recorded in `SOURCE_ORIGIN.txt`. It excludes the previous Git history, user data, private OAuth configuration, and alpha packages. Source availability and experimental disk images do not establish notarization or validated end-user installation.
