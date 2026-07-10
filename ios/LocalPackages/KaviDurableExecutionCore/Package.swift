// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "KaviDurableExecutionCore",
  platforms: [
    .iOS(.v15),
    .macOS(.v12),
  ],
  products: [
    .library(name: "KaviDurableExecutionCore", targets: ["KaviDurableExecutionCore"]),
  ],
  targets: [
    .target(name: "KaviDurableExecutionCore"),
    .testTarget(
      name: "KaviDurableExecutionCoreTests",
      dependencies: ["KaviDurableExecutionCore"]
    ),
  ]
)
