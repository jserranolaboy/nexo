// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "NexoNative",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "NexoKit", targets: ["NexoKit"]),
        .executable(name: "Nexo", targets: ["Nexo"])
    ],
    dependencies: [.package(path: "../Core")],
    targets: [
        .target(name: "NexoKit", dependencies: [.product(name: "NexoCore", package: "Core")]),
        .executableTarget(name: "Nexo", dependencies: ["NexoKit", .product(name: "NexoCore", package: "Core")]),
        .testTarget(name: "NexoKitTests", dependencies: ["NexoKit", .product(name: "NexoCore", package: "Core")])
    ]
)
