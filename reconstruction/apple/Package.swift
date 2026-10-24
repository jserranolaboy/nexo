// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "nexo-adapter",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .executable(name: "nexo-adapter", targets: ["NexoAdapter"]),
        .library(name: "NexoAdapterIOS", type: .static, targets: ["NexoAdapterKit"])
    ],
    targets: [
        .target(name: "NexoAdapterKit"),
        .executableTarget(name: "NexoAdapter", dependencies: ["NexoAdapterKit"]),
        .testTarget(name: "NexoAdapterTests")
    ]
)
