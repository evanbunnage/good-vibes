// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "coolswitch",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "coolswitch", targets: ["coolswitch"])],
    targets: [
        .executableTarget(name: "coolswitch", swiftSettings: [.enableUpcomingFeature("StrictConcurrency")]),
        .testTarget(name: "coolswitchTests", dependencies: ["coolswitch"],
                    swiftSettings: [.enableUpcomingFeature("StrictConcurrency")])
    ],
    swiftLanguageModes: [.v5]
)
