# Integrations and dependencies

| Existing component | Requirement |
| --- | --- |
| Google Drive/OAuth | Optional at runtime. Without configuration or sign-in, local spaces and tools remain available. The owner's configuration is not included. |
| GoogleSignIn-iOS | Build dependency of the current iOS project, supporting the optional Google connection. The SDK was neither added nor removed. |
| React, React DOM, Motion, and Lucide | Interface libraries included by the builder, not remote services that need a subscription or configuration. |
| Vite, TypeScript, and Vitest | Development and test tools; the packaged app does not need the Vite server running. |
| Swift/AppKit/UIKit/WebKit/PDFKit | Native Apple platform components for the interface, storage, and documents. |
| Earlier Python service and generic core client | The service is neither included nor deployed. The core retains historical synchronization code and tests, but the current client does not instantiate that service for local or Drive workflows. |

To build without account configuration, follow the web/native commands in the [README](../README.md). They do not enable the opt-in live Drive test. To package Mac without copying a local configuration, point `NEXO_GOOGLE_CONFIG` to a nonexistent path. Local use requires no API keys, Firebase, custom backend, or additional services. Installing dependencies still needs the usual registries or an available cache.

The application-specific network destinations found in client code correspond to Google OAuth/Drive and the local OAuth callback; the iOS project resolves its SDK from GitHub. This code observation is not a complete traffic capture of every SDK. Preserve and review the [third-party notices](../Next/Experience/public/ThirdPartyNotices.txt).
