# Security boundaries and reporting

Nexo is in development. These notes do not claim a comprehensive audit, a maintained public release with guaranteed support, or authorization to disclose private material.

## Report a problem

Use GitHub's private vulnerability reporting if it is enabled. If no private channel is available, request one with a high-level description. Do not attach personal information, credentials, attendance lists, institutional templates, or details that would enable exploitation.

## Current client boundaries

- Data is stored locally. Exported backups include data and templates and must be treated as private files. Their SHA-256 checksum detects changes but does not encrypt the contents or establish who created them.
- Imports validate schemas and relationships. Restore preserves the previous file and pauses spaces linked to Drive; local revisions and backups do not replace an independent copy.
- Drive is optional and communicates with Google when configured and used. The implementation requests the `drive` scope; scope, cross-account permissions, and verification requirements need review before distribution.
- On Mac, OAuth tokens stay in Keychain and are not returned to the JavaScript bridge. Do not copy them into the repository, reports, or artifacts.
- Development ad-hoc signing is neither a Developer ID identity nor notarization. Do not disable Gatekeeper to distribute or test the app.

The `Sources/VRR` alpha did not have the current client's Drive integration. Its earlier claims of no network use do not describe Nexo.

Before publication, review [files, history, and artifacts](docs/PUBLICATION_REVIEW.md). Changing the latest file or adding a `.gitignore` rule does not remove information already committed.
