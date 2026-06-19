// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "LiteRTLM",
  platforms: [
    .iOS(.v15),
    .macOS(.v12),
  ],
  products: [
    .library(name: "LiteRTLM", targets: ["LiteRTLM"]),
  ],
  targets: [
    .binaryTarget(
      name: "CLiteRTLM",
      url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.13.1/CLiteRTLM.xcframework.zip",
      checksum: "7ff01c42106b754748b5dd3036a4a57161b25ebf523e705bebc1219061852362"
    ),
    .binaryTarget(
      name: "CLiteRTLM_mac",
      url: "https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.13.1/CLiteRTLM_mac.xcframework.zip",
      checksum: "ec9ffe230dc39117a7fc8933b1cc15910454027fee6d3041534ab7cf17313981"
    ),
    .target(
      name: "LiteRTLM",
      dependencies: [
        .target(name: "CLiteRTLM", condition: .when(platforms: [.iOS])),
        .target(name: "CLiteRTLM_mac", condition: .when(platforms: [.macOS])),
      ]
    ),
    .testTarget(
      name: "LiteRTLMLiveTests",
      dependencies: ["LiteRTLM"]
    ),
  ]
)
