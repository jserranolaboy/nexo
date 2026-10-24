// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "nexo-adapter",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "nexo-adapter", targets: ["NexoAdapter"])
    ],
    targets: [
        .executableTarget(name: "NexoAdapter"),
        .testTarget(name: "NexoAdapterTests")
    ]
)
