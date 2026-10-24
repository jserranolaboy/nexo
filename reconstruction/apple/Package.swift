// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "nexo-adapter",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .executable(name: "nexo-adapter", targets: ["NexoAdapter"]),
        .library(name: "NexoAdapterIOS", type: .static, targets: ["NexoAdapterKit"]),
        .executable(name: "NexoInterfaz", targets: ["NexoInterfaz"]),
        .executable(name: "NexoInterfazIOS", targets: ["NexoInterfazIOS"])
    ],
    targets: [
        .target(name: "NexoAdapterKit"),
        .executableTarget(name: "NexoAdapter", dependencies: ["NexoAdapterKit"]),
        .target(
            name: "NexoInterfazUI",
            resources: [.copy("kernel.js")],
            linkerSettings: [.linkedFramework("JavaScriptCore")]
        ),
        .executableTarget(name: "NexoInterfaz", dependencies: ["NexoInterfazUI", "NexoAdapterKit"]),
        .executableTarget(name: "NexoInterfazIOS", dependencies: ["NexoInterfazUI"]),
        .testTarget(name: "NexoAdapterTests", dependencies: ["NexoInterfazUI"])
    ]
)
