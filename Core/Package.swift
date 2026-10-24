// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "NexoCore",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [.library(name: "NexoCore", targets: ["NexoCore"])],
    targets: [
        .target(name: "NexoCore"),
        .executableTarget(name: "NexoCoreChecks", dependencies: ["NexoCore"]),
        .testTarget(name: "NexoCoreTests", dependencies: ["NexoCore"])
    ]
)
