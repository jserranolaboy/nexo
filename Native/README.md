# Nexo Native

`NexoKit` applies workspace commands, transfers backups, retains drafts, and coordinates optional Google Drive collaboration. The `Nexo` executable hosts the interface in AppKit and WKWebView. iOS reuses `NexoKit` through its UIKit host.

```sh
NEXO_LIVE_DRIVE_TEST=0 \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Native --scratch-path /tmp/nexo-native-tests -j 2
```

The suite uses synthetic data and an in-memory Drive transport. Live account tests are opt-in and are not part of routine validation. See the [main build guide](../README.md#build-and-test), [iOS host](../iOS/README.md), and [compatibility contract](../docs/ARCHITECTURE.md).
