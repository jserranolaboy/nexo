# Nexo architecture and compatibility

Nexo has one current client. Folder names describe responsibilities rather than development generations.

| Path | Responsibility |
| --- | --- |
| `Core` / `NexoCore` | Shared models, rules, recoverable persistence, PDF rendering, and Drive change history. |
| `Native` / `NexoKit` | Workspace commands, drafts, portable backups, and optional Drive coordination. |
| `Native/Sources/Nexo` | macOS AppKit/WKWebView application executable. |
| `Web` | Shared React/TypeScript interface and browser simulation. |
| `iOS` | UIKit/WKWebView host and Xcode project. |
| `scripts` | Shared localization, icon, build, and synthetic simulator tooling. |

The interface submits domain commands with the last observed revision. `WorkspaceStore` applies commands to a copy, validates it, and saves through `SnapshotStore`. Successful local commits do not become failed edits merely because a later Drive status read fails. Drive synchronization retains its separate queue and conflict alternatives.

## Compatibility contract

These names intentionally remain unchanged. They identify existing data or platform state and are not competing implementations:

| Identifier | Reason retained |
| --- | --- |
| macOS bundle ID `org.vrr.valentina.experience` | Existing application identity and preferences. |
| `Application Support/Valentina-Experience` and `workspace-v1.json` | Existing Mac workspaces and optional configuration. |
| `Valentina-Experience-QA` | Existing synthetic QA storage convention. |
| `VRR-Next-Preview` | Read-only discovery of the previous preview workspace during first launch. |
| `ValentinaExperienceWindow` | Existing saved window position. |
| `valentina` message handler and `valentina://experience` URL | Native/web bridge contract and resource origin. |
| Current JSON schema, field names, UUIDs, Drive filenames, Keychain service identifiers, and draft keys | Existing saved data, shared folders, and sessions. |
| iOS bundle ID `org.nexo.ios` and its `Application Support/Nexo` directory | Existing iOS app identity and data. |

No migration or live data modification is required for the source/module reorganization. Changing one of these contracts needs a separately reviewed migration with fixtures from earlier versions. The VRR alpha's separate JSON format is not interchangeable with Nexo storage.

Recovery starts a new local revision above the imported, current, and retained backup revisions. Restored content can therefore be equal while its revision differs. Pre-restore writers must reload. Recovery still quarantines the old primary bytes and pauses imported Drive replicas. A restore cannot replace a workspace while its coordinator is synchronizing.

## Build entry points

Use the root `Makefile` for local suites, or the explicit commands in the main README. `scripts/build-macos.sh` packages the current executable as `Nexo.app`. Preferred output overrides are `NEXO_APP_DIR` and `NEXO_BUILD_DIR`; the older `VALENTINA_APP_DIR` and `VALENTINA_BUILD_DIR` remain aliases for existing local build commands. The builder does not automatically discover or include OAuth configuration; `NEXO_GOOGLE_CONFIG` must explicitly point to a file when that optional configuration is intended.

The checked-in iOS project is generated from `iOS/project.yml`. Update the specification, regenerate with XcodeGen, and inspect the resulting paths and signing settings together. Generated web resources and icons remain untracked.
