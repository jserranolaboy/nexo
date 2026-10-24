# Development status

Version 0.4.1 (11) is development work, not a stable application distribution. The separate [0.4.0 source preview](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.0-preview.1) remains fixed at `8356404` and contains none of this consolidation.

## Implemented across both phases

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

## Follow-up reliability fixes

- Event duplication and its copied roster now use one native command, revision, and Drive change batch. Invalid roster input leaves primary bytes and pending history unchanged; a retry creates only one event. The browser simulation applies the same atomic behavior.
- Failed inline component/category creation preserves the entered name and current selection. Enter/blur and form-submit guards prevent duplicate requests before React rerenders.
- Component filtering immediately hides unrelated event detail. Phone navigation clears the selection; wider layouts choose a matching event or clear detail when the filter has no results.
- PDF page fitting, page choices, table dragging, mobile position controls, and row-height edits reserve the renderer's header, footer, and one complete minimum row. Unsupported/nonfinite geometry is rejected; existing small templates remain readable for repair.
- Malformed optional Mac Google configuration no longer disables its own repair controls or reads a session at startup. Deliberate repair preserves the malformed file privately before replacing it. Import does not delete a stored session.
- In-flight token responses cannot save or return credentials after an explicit configuration/session change, including a client round trip. Routine concurrent refreshes remain supported. A valid configuration import reports success even if later session restoration fails; the separate status error explains that failure.

## Checks after consolidation

Checks use synthetic fixtures, temporary build directories, and fake Drive transport. They do not access live accounts or real workspaces.

| Check | Result |
| --- | --- |
| Core XCTest suite | 42 passed; `NexoCoreChecks` executable also passed. |
| Native Swift Testing suite | 42 executed successfully; 1 opt-in live Drive test skipped (43 reported). The auth suite has 7 tests covering 9 cases. |
| Web Vitest suite | 79 passed across 7 files. |
| TypeScript and production web build | Passed; existing main-chunk size warning remains. |
| Universal Mac app package | Built as 0.4.1 (11), arm64 and x86_64, ad-hoc signature verified, no bundled OAuth configuration. Mach-O minimum target is macOS 15. |
| iOS generated project | Regenerated with XcodeGen using the new package and test paths. |
| iOS simulator compilation | Phase-2 app and unit-target `build-for-testing` passed with `CODE_SIGNING_ALLOWED=NO`; tests were not executed on iOS. No simulator runtime is installed. |

The web regressions exercise production callbacks/effect lifetimes with a small test harness using existing dependencies, plus pure domain fixtures. Against the consolidated phase-1 commit `2a20b41`, the current 79-test suite produces 37 failures and 42 passes; all 79 pass with these fixes. The earlier regressions remain green. These are not DOM, accessibility, or visual integration tests.

An independent review of immutable `2a20b41` repeated 42 core tests, 31 native tests (plus one live test skipped), the core executable checks, and localization checks. It found no new recovery or module-layout regression. Phase-2 review also checked atomic history staging and added a Drive-linked regression.

A separate ad-hoc Mac QA bundle with an empty synthetic HOME was prepared. Its opening attempt failed in the control transport before a screen could be observed. After reconnection, neither a QA process nor its isolated primary data file existed. Mac startup/visual QA therefore remains unverified; no binary was attached to the source prerelease.

## Cloud reliability follow-up — October 24, 2026

The cloud checkout began at `085f8ec`. This work changes only the shared web interface, its tests, and this status; native persistence, serialized identifiers, dependencies, installer scripts, and release versions are unchanged.

- Management forms guard repeated component/category/group submissions synchronously. Inline renaming does not submit twice through Enter/blur, and Escape cannot commit a canceled edit through a trailing blur. Failed edits retain their names for retry; pending requests are not presented as canceled.
- A PDF preview is invalidated when its organization, event, or included attendance changes, including a Drive synchronization that was already in flight before the editor opened. Older render and page responses cannot restore stale output. Unrelated snapshot changes retain a valid PDF, and invalidation preserves unsaved template edits.
- Desktop/mobile image sizing shares aspect-ratio-preserving limits for both dimensions and page bounds. Mobile text widths respect the native 60-point minimum. These controls no longer create the reproduced undersized-element save failures; native validation is unchanged.

Validation on Linux with Node 24.22.1 and the pinned pnpm 11.19.0: **106 web tests pass**, TypeScript and the production build pass, and localization and whitespace checks pass. The initial 79-test baseline was green. Seventeen added interaction regressions failed before their corresponding fixes; the other new cases cover unchanged-input behavior and geometry boundaries. Existing main-chunk size warnings remain. Callback tests are not DOM, visual, accessibility, or native-renderer integration tests.

Swift, Xcode, and Apple UI runtimes are unavailable in this cloud environment. The historical Core/Native/macOS/iOS results above were not repeated here. No installed app, user workspace, Drive account, prerelease, or stable release was modified. The later installer staging/backup/rollback work remains uncommitted on the offline Mac and has **not** been recovered into this checkout; reconcile it separately before installer integration. Native export/PDF, final package, actual Sequoia and physical-device verification remain pending.

## Remaining findings and next work

| Priority | Finding | Why it remains |
| --- | --- | --- |
| P2 | Store date encoding truncates fractional seconds and can change volunteer tie order. | Requires coordinated store/transfer/Drive codecs and older-client compatibility tests; no on-disk date format change was made here. |
| P2 | Whole-snapshot validation accepts an already over-capacity volunteer roster. | Must define repair behavior for existing snapshots before tightening load validation and potentially stranding old data. Command selection still enforces capacity. |

Native startup and visual interaction, accessibility/focus behavior, actual Sequoia runtime, physical iPhone/iPad execution, cross-account/two-Mac Drive, alpha migration, and Developer ID/notarized distribution remain pending. Build success and configured deployment targets do not establish those properties. Drive history compaction is also unfinished. These limits preclude a stable binary release in this phase.
