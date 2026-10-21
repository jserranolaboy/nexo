# Contributing to Nexo

The current client lives in `Next/Experience`. See the [README](README.md) for architecture and product rules. This snapshot excludes the VRR prototype and private project notes.

## Changes and tests

- Keep each change focused on one outcome and preserve other people's work.
- The interface uses React/TypeScript; native operations live in `ExperienceKit` and shared rules in `VRRCore`. Keep validation in the layer that applies the change.
- Preserve keys, formats, and directories unless a reviewed migration includes tests using copies.
- Add new text to the English/Spanish localization system. Check the catalogs with `node Next/Experience/scripts/sync-locales.mjs --check`.
- Use synthetic data and temporary directories. Live Drive tests require authorization for the account and operations; do not enable `NEXO_LIVE_DRIVE_TEST` in the routine suite.
- Run the [web and native tests](README.md#build-and-test) and checks relevant to the changed area. Distinguish compilation, automated tests, visual review, and physical-device testing.

Run pnpm from `Next/Experience` to use the version pinned in `packageManager`. You do not need to install the app to build or run the local suites.

## Data and publication

Do not include real people, attendance records, institutional templates, credentials, exports, or account screenshots in code, issues, or shared changes. Remote synchronization, permissions, and new network calls need an explicit product decision.

Describe the problem, the visible outcome, and the checks actually performed. Screenshots must use synthetic data and pass content and metadata review. See the [publication scope](docs/PUBLICATION_REVIEW.md).

The legacy root-level Swift suite and `scripts/build-app.sh` belong to the VRR alpha and are not included here; they do not build or verify the current Nexo client. Repository renames, visibility changes, and release publication require their own explicit scope.
