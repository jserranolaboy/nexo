# Development status

Version 0.4.1 (11) is development work, not a stable application distribution. The separate [0.4.0 source preview](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.0-preview.1) remains fixed at `8356404` and contains none of this consolidation.

## Implemented in this phase

- One responsibility-based source layout: `Core`, `Native`, `Web`, `iOS`, and `scripts`. Swift modules are `NexoCore` and `NexoKit`; the Mac executable is `Nexo`. Existing persistent identifiers are documented in the [compatibility contract](ARCHITECTURE.md).
- Recovery allocates a new revision above imported/current/retained revisions, so a pre-restore writer cannot overwrite a new post-restore edit. Prior bytes and restored content are preserved independently; revision overflow fails safely.
- Legacy imports reject attendance whose event is missing, instead of silently discarding records while reporting success. Direct snapshots and backup envelopes are covered.
- Volunteer selection rechecks current member eligibility; deactivated applicants cannot be selected.
- Both native PDF importers use the renderer's page feasibility rule and skip undersized pages. Previously saved tiny templates remain readable so users can repair them.
- Both native hosts recheck synchronization immediately around workspace recovery, after the file picker and confirmation. An active coordinator cannot continue uploading into a replaced workspace.
- Escape, History, and roster exclusion preserve dirty attendance notes. Failed note saves retain text and prevent navigation; retry does not save the same note twice.
- Failure to read Drive status after a committed edit records a Drive error without reporting the edit as failed.
- Saving a template copy resets Undo/Redo at the new document boundary while retaining edits made during the save.
- Mac packaging excludes OAuth configuration by default and only includes an explicitly supplied configuration file. Existing build output variables remain aliases; no dependency or external service was added.

## Checks after consolidation

Checks use synthetic fixtures, temporary build directories, and fake Drive transport. They do not access live accounts or real workspaces.

| Check | Result |
| --- | --- |
| Core XCTest suite | 42 passed; `NexoCoreChecks` executable also passed. |
| Native Swift Testing suite | 31 executed successfully; 1 opt-in live Drive test skipped (32 reported). |
| Web Vitest suite | 36 passed across 6 files. |
| TypeScript and production web build | Passed; existing main-chunk size warning remains. |
| Universal Mac app package | Built as 0.4.1 (11), arm64 and x86_64, ad-hoc signature verified, no bundled OAuth configuration. Mach-O minimum target is macOS 15. |
| iOS generated project | Regenerated with XcodeGen using the new package and test paths. |
| iOS simulator compilation | Generic simulator `build` and unit-target `build-for-testing` passed with `CODE_SIGNING_ALLOWED=NO`; tests were not executed on iOS. |

The ten new web interaction regressions exercise production callbacks/effect lifetimes with a small test harness using existing dependencies. Nine fail against the original baseline. They are not DOM, accessibility, or visual integration tests.

## Remaining findings and next work

| Priority | Finding | Why it remains |
| --- | --- | --- |
| P2 | Duplicating an event and roster uses two commits; roster failure can leave an event that a retry duplicates again. | Needs an atomic command or explicitly resumable creation state, with failed-second-step regression. |
| P2 | Failed inline component/category creation selects an uncreated ID and clears the entered name. | Needs form-result and retry regressions across the inline chip and parent form. |
| P2 | Component filtering can retain a selected event from another component. | Needs consistent selection rules across phone, tablet, and desktop navigation. |
| P2 | Malformed optional Google configuration blocks its own repair controls on Mac. | Must enable replacement without discarding configuration or sessions; test with synthetic configuration and injected session access. |
| P2 | Store date encoding truncates fractional seconds and can change volunteer tie order. | Requires coordinated store/transfer/Drive codecs and older-client compatibility tests; no on-disk date format change was made here. |
| P2 | Whole-snapshot validation accepts an already over-capacity volunteer roster. | Must define repair behavior for existing snapshots before tightening load validation and potentially stranding old data. Command selection still enforces capacity. |

Native startup and visual interaction, accessibility/focus behavior, actual Sequoia runtime, physical iPhone/iPad execution, cross-account/two-Mac Drive, alpha migration, and Developer ID/notarized distribution remain pending. Build success and configured deployment targets do not establish those properties. Drive history compaction is also unfinished. These limits preclude a stable binary release in this phase.
