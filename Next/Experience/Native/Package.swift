// swift-tools-version: 6.1
import PackageDescription
let package = Package(name: "ValentinaExperience", platforms: [.macOS(.v15), .iOS(.v18)], products: [.library(name: "ExperienceKit", targets: ["ExperienceKit"])], dependencies: [.package(path: "../..")], targets: [
    .target(name: "ExperienceKit", dependencies: [.product(name: "VRRCore", package: "Next")]),
    .executableTarget(name: "ValentinaExperience", dependencies: ["ExperienceKit", .product(name: "VRRCore", package: "Next")]),
    .testTarget(name: "ExperienceKitTests", dependencies: ["ExperienceKit", .product(name: "VRRCore", package: "Next")])
])
