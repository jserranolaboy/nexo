// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "VRRCore",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [.library(name: "VRRCore", targets: ["VRRCore"])],
    targets: [
        .target(name: "VRRCore"),
        .executableTarget(name: "VRRCoreChecks", dependencies: ["VRRCore"]),
        .testTarget(name: "VRRCoreTests", dependencies: ["VRRCore"])
    ]
)
