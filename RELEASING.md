# Prepare a Nexo release

The current Nexo client uses `Core`, `Native`, `Web`, and `iOS`. VRR's ZIP/DMG files and cask are historical; do not rename or reuse them as a Nexo release. This document does not authorize publication, distribution signing, or visibility changes.

## Local checks

1. Use an isolated copy or branch and synthetic data. Run the [web and native tests](README.md#build-and-test).
2. Keep versions consistent across `Web/package.json`, `Native/Info.plist`, `iOS/Info.plist`, and `iOS/project.yml`. The iOS plist resolves `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` from the project settings. Record the exact commit and checksums as well as the displayed version.
3. Review the inputs to `scripts/build-macos.sh`. By default, it installs in `~/Applications/Nexo.app`, retains the previous app, copies an existing primary data file, and verifies that it did not change. Close Nexo first.
4. The script accepts `NEXO_BUILD_DIR` and `NEXO_APP_DIR` (with older `VALENTINA_*` compatibility aliases) to change its outputs. Changing the app's path alone does not isolate its storage. Runtime tests need a separate QA environment; do not open two copies against the same data.
5. OAuth configuration is excluded by default. Review any explicit `NEXO_GOOGLE_CONFIG`: the builder includes that file as `GoogleOAuth.json`. User credentials are not part of a distribution. Do not read, export, or include tokens when preparing a package.
6. Inspect the final app's version, web assets, icon, architectures, and signature. The script uses ad-hoc signing by default or the identity in `NEXO_SIGN_IDENTITY`; it does not implement notarization or create Nexo ZIP/DMG files.

## Before distribution

- Complete the [publication review](docs/PUBLICATION_REVIEW.md) and obtain the owner's specific authorization.
- Test on an actual Sequoia Mac, in real WebKit, and on the devices you intend to advertise. A universal build or minimum deployment target does not replace those checks.
- Verify updates, backups, restore, and templates with synthetic data, plus migration from a copy of VRR if offering that compatibility.
- Review Drive with authorized accounts and permissions, including disconnection and concurrent edits. Keep independent backups.
- Prepare Developer ID/notarization for Mac or the iOS distribution requirements separately. Do not describe a delivery as signed or notarized without verifying the final artifacts.
- Assign a new version/build and document completed checks and remaining work. Retain checksums and provenance for the package actually delivered.

## VRR alpha

`AppBundle/Info.plist`, `scripts/build-app.sh`, `Casks/vrr.rb`, and the `v0.2.0-beta.*` releases belong to VRR. Its `VRR_SIGNING_IDENTITY` and `VRR_NOTARY_PROFILE` variables are not used by the Nexo builder. Historical tags, names, and checksums remain unchanged.

## Source previews

If native startup QA is incomplete, publish source only as a prerelease, reference the exact verified commit, and omit application binaries. State which tests ran, which remain pending, and that source builds are not notarized distribution. The existing [0.4.0 source preview](https://github.com/jserranolaboy/nexo/releases/tag/v0.4.0-preview.1) follows this policy.
