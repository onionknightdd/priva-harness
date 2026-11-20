// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "PrivaComputerTray",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "PrivaComputerTray", targets: ["PrivaComputerTray"])],
    targets: [
        .executableTarget(name: "PrivaComputerTray"),
        .testTarget(name: "PrivaComputerTrayTests", dependencies: ["PrivaComputerTray"],
                    path: "tests/PrivaComputerTrayTests"),
    ]
)
