import Foundation

private let bytesInGb = 1024.0 * 1024.0 * 1024.0
private let memoryHardBlockRatio = 0.9
private let lowMemoryDeviceGb = 6.0

final class LocalLlmRuntimeMetrics {
  var engineCreateCount = 0
  var engineReuseCount = 0
  var conversationCreateCount = 0
  var conversationReuseCount = 0
  var backendFallbackCount = 0
  var activeRequestStartCount = 0
  var activeRequestEndCount = 0
  var activeRequestCancelCount = 0

  func toDictionary() -> [String: Any] {
    [
      "engineCreateCount": engineCreateCount,
      "engineReuseCount": engineReuseCount,
      "conversationCreateCount": conversationCreateCount,
      "conversationReuseCount": conversationReuseCount,
      "backendFallbackCount": backendFallbackCount,
      "activeRequestStartCount": activeRequestStartCount,
      "activeRequestEndCount": activeRequestEndCount,
      "activeRequestCancelCount": activeRequestCancelCount,
    ]
  }
}

final class LocalLlmDeviceInfo {
  var deviceMemoryGb: Double {
    Double(ProcessInfo.processInfo.physicalMemory) / bytesInGb
  }

  /// The phone's heat, as the app's thermal policy names it.
  var thermalState: String? {
    switch ProcessInfo.processInfo.thermalState {
    case .nominal:
      return "nominal"
    case .fair:
      return "fair"
    case .serious:
      return "serious"
    case .critical:
      return "critical"
    @unknown default:
      return nil
    }
  }

  func validateMemory(minDeviceMemoryGb: Int?) throws {
    guard let minDeviceMemoryGb else {
      return
    }
    let availableGb = deviceMemoryGb
    if availableGb + 0.01 < Double(minDeviceMemoryGb) * memoryHardBlockRatio {
      throw LocalLlmBridgeError.insufficientMemory(
        requiredGb: minDeviceMemoryGb,
        availableGb: availableGb
      )
    }
  }

  func availability(metrics: LocalLlmRuntimeMetrics) -> [String: Any] {
    let memoryGb = deviceMemoryGb
    return [
      "available": true,
      "linked": true,
      "platform": "ios",
      "runtime": "litert-lm",
      "reason": NSNull(),
      "supportsStreaming": true,
      "supportedAccelerators": localLlmSupportedIosAccelerators,
      "deviceMemoryGb": memoryGb,
      "lowMemoryDevice": memoryGb < lowMemoryDeviceGb,
      "thermalState": thermalState ?? NSNull(),
      "accelerationFeatures": [
        "constrainedDecodingEnabled": false,
        "speculativeDecodingSupported": NSNull(),
        "speculativeDecodingEnabled": false,
      ],
      "runtimeMetrics": metrics.toDictionary(),
    ]
  }
}
