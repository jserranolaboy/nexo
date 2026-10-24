# Development status

Current development source is **0.4.1 (12)** on `refactor/nexo-identity-and-reliability`. It is not a stable application distribution. The build 11 results below are an earlier checkpoint. The separate [0.4.0 source preview](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.0-preview.1) remains fixed at `8356404` and contains none of this consolidation.

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

The cloud checkout began at `085f8ec`. This work changes the shared web interface, its tests, this status, and the generated native localization string table; native implementation and persistence, serialized identifiers, dependencies, installer scripts, and release versions are unchanged.

- Management forms guard repeated component/category/group submissions synchronously. Inline renaming does not submit twice through Enter/blur, and Escape cannot commit a canceled edit through a trailing blur. Failed edits retain their names for retry; pending requests are not presented as canceled. Space-switcher renaming has the same request/cancellation guards and is keyed to the active space so a different space cannot inherit its draft name.
- Inline event-classification creation also invalidates canceled and completed input sessions. Escape cannot create a component/category through a trailing blur or hide an outstanding request's failed name. A delayed creation cannot overwrite a newer explicit component/category choice, and category input drafts are scoped to the selected component.
- Event and simple creation/edit forms share a session-aware dismissal guard. A submitted write cannot be presented as canceled, and primary-save controls stop accepting edits that would otherwise be discarded on success. Inline classification writes still allow newer choices. External closure, context changes, exit animations, unmounts, and rapid reopening invalidate old navigation/error callbacks without unlocking a newer request; failed saves retain editable drafts for retry. Phone form/roster swipes spring back when a pending-write guard refuses dismissal; accepted dismissals retain their existing exit animation.
- Roster pickers share a synchronous lock for new-person creation and roster submission. Repeated Enter/click callbacks cannot create duplicate people or queue duplicate rosters. Pending controls remain read-only/disabled instead of presenting a submitted request as canceled; failed names/selections remain retryable. Changing the event or picker mode starts a fresh session, and old success/error/completion callbacks cannot modify its input or request state.
- A PDF preview is invalidated when its organization, event, or included attendance changes, including a Drive synchronization that was already in flight before the editor opened. Older render and page responses cannot restore stale output. Unrelated snapshot changes retain a valid PDF, and invalidation preserves unsaved template edits.
- Startup waits for local draft recovery before any real editor can mount and replace the saved draft. Failed reads remain blocked and retryable without writing or clearing the draft; mode changes and unmounts ignore old responses. A persistently unreadable or malformed draft keeps the real workspace on this recovery screen until the original file is repaired; Retry never discards it. If the draft’s space is trashed or missing, the recovery screen explains the problem and offers an explicit space restore or the existing confirmed backup-import flow, then retries recovery.
- Template saves and copies share one in-flight result, so repeated callbacks cannot create extra copies or resolve before the save succeeds. Failed saves remain retryable. Image/PDF imports and repeated text additions use the latest draft instead of dropping newer edits; older PDF import responses cannot override a newer import or an explicit blank-paper choice, Undo, or Redo.
- Desktop/mobile image sizing shares aspect-ratio-preserving limits for both dimensions and page bounds. Mobile text widths respect the native 60-point minimum. These controls no longer create the reproduced undersized-element save failures; native validation is unchanged.
- Volunteer suggestion ordering compares parsed date instants rather than ISO text, including the latest previous participation and registration-time ties. Equivalent offset/fractional spellings use the existing member-identity tie-break. Invalid registration dates remain visible after dated peers with equal participation history, with identity as the deterministic fallback; no source date is rewritten. This is a domain robustness correction for mixed-format inputs, not an observed normal-UI incident: current native snapshots and browser simulation each normalize their own dates. JavaScript comparison has millisecond precision; native store truncation and codec compatibility remain separate work.

Validation on Linux with Node 24.22.1 and the pinned pnpm 11.19.0: **195 web tests pass**, TypeScript and the production build pass, and localization and whitespace checks pass. The initial 79-test baseline was green. Forty-six initial cloud interaction regressions failed before their corresponding fixes; 9 further event-classification regressions failed on `29f5066`, and 11 roster-picker cases failed on `9e0c007` with one existing retry control passing. All 17 primary-form lifetime cases fail on `fdd38b9` before the corresponding fix. Three additional swipe-refusal cases failed before the shared-sheet adjustment; accepted-dismissal controls remain green. The date-order suite adds 10 before-fix failures and 3 controls. Other new cases cover unchanged-input behavior and geometry boundaries. Existing main-chunk size warnings remain. Callback tests are not DOM, visual, accessibility, or native-renderer integration tests.

Swift, Xcode, and Apple UI runtimes are unavailable in this cloud environment. The historical Core/Native/macOS/iOS results above were not repeated here. No installed app, user workspace, Drive account, prerelease, or stable release was modified. The later installer staging/backup/rollback work remains uncommitted on the offline Mac and has **not** been recovered into this checkout; reconcile it separately before installer integration. Native export/PDF, final package, actual Sequoia and physical-device verification remain pending. The checkpoint at `96e6b6b` records the packaging published after this note and what a GitHub clone still cannot see on the Mac.

The [web CI workflow](../.github/workflows/web-ci.yml) repeats the existing locked install, tests, build, and locale check on a standard GitHub-hosted Ubuntu runner. It uses pinned official actions and Node, the existing pinned pnpm, read-only token permissions, and no persisted checkout credentials, deployment, secrets, or live accounts. PR merge-result and development-branch head checks remain distinct. Hosted results must be verified for the exact commit; the configuration itself does not establish a pass or any native/runtime coverage.

## Checkpoint at `96e6b6b` — 24 October 2026

`Native/Info.plist` and the iOS project both carry build 12. `main` is still the 0.4.0 source preview at `8356404`. Draft [pull request 1](https://github.com/jserranolaboy/nexo/pull/1) is this development branch: 54 commits ahead of `main` and none behind. Tag `v0.4.1-preview.2` (`af263a2`) is the experimental disk image; this commit is four commits later. Draft [pull request 2](https://github.com/jserranolaboy/nexo/pull/2) still expects an overflowing PDF title, footer, or column heading to be preserved. This branch refuses that overflow before it writes output, so pull request 2 must not be merged here. Its snapshot-interval test names are already present on this branch.

The sections above keep the results they recorded at the time. Build 11, the 195-test web run, and “iOS tests were not executed” belong to those earlier checkpoints. Disk-image packaging and its synthetic validators are in this commit. A clone of GitHub cannot show whether the Mac working copy still has further uncommitted files.

### Checked on Linux for `96e6b6b`

Node 22.23.4 and the pinned pnpm 11.19.0. Hosted Web CI uses Node 24.22.1. No live Drive account and no Swift toolchain were available.

| Check | Result |
| --- | --- |
| Locale catalog synchronization | Passed |
| Recovery and process-cleanup script tests | 16 passed |
| Release-gate unit tests | 30 passed |
| Packaging-boundary unit tests | 38 passed, using synthetic files only |
| Shell syntax of the Mac package scripts | Passed; the scripts were not executed |
| Web Vitest | 320 passed across 9 files |
| TypeScript and production web build | Passed; the main chunk remains over 500 kB |
| Browser smoke of the production bundle | Passed for rename cancellation, attendance-note focus, and synthetic draft recovery |

### Reported by GitHub Actions for `96e6b6b`

These are hosted job results, not a second execution in the review environment. Read the log for the exact commit before reusing the conclusion.

- [Web CI](https://github.com/jserranolaboy/nexo/actions/runs/40120393212) passed, including its browser smoke.
- [Native CI](https://github.com/jserranolaboy/nexo/actions/runs/40120393223) passed Core tests, the Core executable checks, Native tests with live Drive skipped, and the universal Mac executable.
- That same Native CI run passed disposable iOS simulator unit tests, fresh-install persistence, and native PDF preview smoke.
- The Mac disk image workflow completed successfully. That does not notarize the app or validate replacement of an existing installation.

### Next stages

A stage is finished only when its check holds. These checks do not by themselves merge pull request 1 or move `main`.

1. Compare any Mac working copy with `96e6b6b` and publish uncommitted files on a new branch from that commit. Done when that diff is on GitHub and the existing commits are unchanged.
2. Keep this status, the iOS guide, and the version settings on build 12. Done when those files agree and `main` is still `8356404`.
3. Review pull request 1 in slices while it stays a draft. Keep or close pull request 2 only after confirming that none of its unique assertions are still required. Done when that decision is recorded on the pull request.
4. Fractional-second date encoding and already over-capacity volunteer rosters remain separate changes with compatibility tests. Physical devices, two-account Drive, VRR migration, and Developer ID signing remain pending until each one has its own evidence.

## Remaining findings and next work

| Priority | Finding | Why it remains |
| --- | --- | --- |
| P2 | Store date encoding truncates fractional seconds and can change volunteer tie order. | Requires coordinated store/transfer/Drive codecs and older-client compatibility tests; no on-disk date format change was made here. |
| P2 | Whole-snapshot validation accepts an already over-capacity volunteer roster. | Must define repair behavior for existing snapshots before tightening load validation and potentially stranding old data. Command selection still enforces capacity. |

Native startup and visual interaction, accessibility/focus behavior, actual Sequoia runtime, physical iPhone/iPad execution, cross-account/two-Mac Drive, alpha migration, and Developer ID/notarized distribution remain pending. Build success and configured deployment targets do not establish those properties. Drive history compaction is also unfinished. These limits preclude a stable binary release in this phase.
