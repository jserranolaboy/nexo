# Nexo Core

`NexoCore` is the shared Swift library for workspace models, attendance and volunteer rules, recoverable persistence, PDF generation, and Drive change history. It has no third-party package dependencies. The macOS and iOS hosts use the same domain rules.

From the repository root:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Core --scratch-path /tmp/nexo-core-tests -j 2
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift run --package-path Core --scratch-path /tmp/nexo-core-tests NexoCoreChecks
```

Tests and executable checks use synthetic data. See the [architecture and compatibility contract](../docs/ARCHITECTURE.md) before changing persisted models or recovery behavior.
