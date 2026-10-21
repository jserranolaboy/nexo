# Nexo core and clients

The current client is [Nexo in `Experience`](Experience/README.md): React/Motion in WKWebView, AppKit on Mac, and UIKit on iPhone/iPad. See the [main README](../README.md) for requirements, build instructions, tests, and verification status.

## Current code

- `Sources/VRRCore`: models, rules, recoverable local persistence, PDF, and Drive causal history.
- `Tests/VRRCoreTests`: core tests with synthetic data.
- `Experience/src`: interface and coordination with the native bridge.
- `Experience/Native`: Mac client and `ExperienceKit`, shared with iOS.
- `Experience/iOS`: UIKit container and Xcode project.

Each association contains people, groups, periods, activity components, categories, events, attendance, volunteering, and templates. Percentages are individual: `present / (present + absent)`. People outside a roster do not acquire absences; excused, pending, and removed records, plus cancelled or non-counting events, are excluded from the denominator.

Volunteering suggests an order based on lower completed participation, with manual selection and capacity limits. Expressing interest or being selected does not earn participation credit. Templates affect the document, not the attendance result.

`SnapshotStore` preserves revisions and copies before replacing the primary file and compacts older local backups. Current collaboration uses Google Drive and does not require the earlier Python service. Neither Drive nor local persistence replaces an independent backup.

## Provenance

The SwiftUI MacApp, Service, and VRR prototypes are not part of this snapshot. The core retains its internal names to preserve formats and data continuity. Migration from the VRR alpha still requires validation using copies.
