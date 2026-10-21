# Nexo: current client

React/Motion interface in AppKit/WKWebView on Mac and UIKit/WKWebView on iPhone/iPad. The [main README](../../README.md) covers features, requirements, build/test commands, and verification limits.

## Local use without Drive

The app lets you create spaces and use the agenda, people, attendance, volunteering, PDFs, and local backups without configuring a Google account. The development browser uses synthetic data and does not replace native storage or PDFs.

From this directory, run `pnpm install --frozen-lockfile`, followed by `pnpm dev`, `pnpm test`, or `pnpm build`. The pinned package manager is 11.19.0. The development server listens on `127.0.0.1:5188`; the packaged app does not require it.

## Mac app bundle without OAuth configuration

From the repository root, `zsh Next/Experience/build-experience.sh` builds and installs in `~/Applications/Nexo.app`. It checks that the app is closed and retains the previous app and a copy of any existing primary data file. To prevent it from including an OAuth configuration already on the Mac, point `NEXO_GOOGLE_CONFIG` to a nonexistent file; do not change or delete the original configuration. This preserves the collaboration code.

`VALENTINA_APP_DIR` changes the app output path and `VALENTINA_BUILD_DIR` its build directory. A different output path does not isolate runtime data. Signing is ad-hoc by default; the script produces neither notarization nor ZIP/DMG files. See [release preparation](../../RELEASING.md).

## Collaborating through Google Drive

Drive is the client's remote integration and is optional: connect an account and link each space explicitly. Connecting an account does not automatically upload all local spaces. The owner shares the folder in Drive; Nexo does not send invitations.

Mac uses external-browser OAuth, PKCE, and Keychain tokens. It requests the `drive` scope. OAuth configuration and sessions are not included in this snapshot; owners must configure their own client to use collaboration. iOS retains the GoogleSignIn dependency to compile collaboration code, although local use does not require signing in. Review scope, cross-account permissions, and Google's requirements before distribution.

Local edits and their queue are saved in the same revision. Synchronization preserves alternatives when changes conflict. Imported backups retain history and pending changes but pause Drive. Remote availability depends on Google and folder permissions. Drive does not replace an independent backup.

## Storage and recovery

Mac retains `~/Library/Application Support/Valentina-Experience/workspace-v1.json`. The core validates relationships and revisions and preserves copies before replacing the primary file. On save, it keeps the 60 most recent copies, then one per hour for two days, one per day up to 60 days, and one per week for older copies. Drive causal history is not compacted.

Exports include saved templates with their PDFs and images; the SHA-256 checksum does not encrypt data. Drafts are stored separately. Restore validates the backup, preserves the previous file, and pauses Drive. Do not copy the VRR alpha's JSON over this storage.

## Interface 0.4

Three areas: Events, People, and Documents. Wide Mac/iPad layouts use a sidebar; portrait iPad places the agenda and event together with bottom tabs. On iPhone, an event opens over the agenda. Tapping or swiping a row can record attendance; volunteer selection remains manual. Excused, pending, and removed records do not count toward the percentage.

The [iOS guide](iOS/README.md) covers resource preparation and optional configuration. Visual runtime review of the current build remains pending; see the exact test status in the main README.
