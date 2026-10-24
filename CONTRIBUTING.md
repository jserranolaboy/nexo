# Contributing to Nexo

The current client is organized into `Core`, `Native`, `Web`, and `iOS`. See the [README](README.md) for architecture and product rules. This snapshot excludes the VRR prototype and private project notes.

## Changes and tests

- Keep each change focused on one outcome and preserve other people's work.
- The interface uses React/TypeScript; native operations live in `NexoKit` and shared rules in `NexoCore`. Keep validation in the layer that applies the change.
- Preserve keys, formats, and directories unless a reviewed migration includes tests using copies.
- Add new text to the English/Spanish localization system. Check the catalogs with `node scripts/sync-locales.mjs --check`.
- Use synthetic data and temporary directories. Live Drive tests require authorization for the account and operations; do not enable `NEXO_LIVE_DRIVE_TEST` in the routine suite.
- Run the [web and native tests](README.md#build-and-test) and checks relevant to the changed area. Distinguish compilation, automated tests, visual review, and physical-device testing.

Run pnpm from `Web` to use the version pinned in `packageManager`. You do not need to install the app to build or run the local suites.

### Web CI

[Web CI](.github/workflows/web-ci.yml) runs the frozen-lockfile install, web tests, TypeScript/production build, and locale synchronization check on a standard Ubuntu runner with Node 24.22.1 and the pnpm version in `Web/package.json`. It does not build or test Swift, Apple UI, native PDF rendering, or an installer.

Pull requests targeting `main` test the proposed merge result; development-branch pushes test the exact branch head. Both can run for an open PR because they validate different source trees. Superseded runs within each event/ref are canceled. Actions are pinned to reviewed official release commits, token permissions are read-only, and checkout credentials are not persisted. No deployment, secret, environment, persistent package cache, or live account is configured.

Read the checks and logs for the specific commit before reporting CI success. Defining a workflow or passing local tests is not evidence of a successful hosted run.

## Data and publication

Do not include real people, attendance records, institutional templates, credentials, exports, or account screenshots in code, issues, or shared changes. Remote synchronization, permissions, and new network calls need an explicit product decision.

Describe the problem, the visible outcome, and the checks actually performed. Screenshots must use synthetic data and pass content and metadata review. See the [publication scope](docs/PUBLICATION_REVIEW.md).

Use the current root `Makefile` or documented commands. The alpha implementations are excluded. Repository renames, visibility changes, and release publication require their own explicit scope.
