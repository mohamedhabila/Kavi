import Foundation

struct LiteRTLMBenchmarkConfig {
  let platform: String
  let deviceId: String?
  let appId: String?
  let modelId: String
  let modelPath: String
  let runtime: String
  let backend: String
  let modelSupportsTools: Bool
  let conversationTurns: Int
  let scenarioIds: [String]

  static func read(from path: String) throws -> LiteRTLMBenchmarkConfig {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw BenchmarkError.invalidConfig("Plan root must be a JSON object.")
    }
    let model = try object(root["model"], label: "model")
    let device = root["device"] as? [String: Any]
    let app = root["app"] as? [String: Any]
    let defaults = root["defaults"] as? [String: Any]
    let capabilities = model["capabilities"] as? [String: Any]
    let scenarioIds = try array(root["scenarios"], label: "scenarios")
      .compactMap { item -> String? in
        guard let scenario = item as? [String: Any] else { return nil }
        return scenario["id"] as? String
      }

    return LiteRTLMBenchmarkConfig(
      platform: root["platform"] as? String ?? "ios",
      deviceId: device?["deviceId"] as? String,
      appId: app?["appId"] as? String,
      modelId: try string(model["modelId"], label: "model.modelId"),
      modelPath: try string(model["modelPath"], label: "model.modelPath"),
      runtime: model["runtime"] as? String ?? "litert-lm",
      backend: model["backend"] as? String ?? "cpu",
      modelSupportsTools: capabilities?["tools"] as? Bool ?? false,
      conversationTurns: defaults?["conversationTurns"] as? Int ?? 20,
      scenarioIds: scenarioIds
    )
  }

  func shouldRun(_ scenarioId: String) -> Bool {
    scenarioIds.isEmpty || scenarioIds.contains(scenarioId)
  }
}

enum BenchmarkError: Error, LocalizedError {
  case invalidConfig(String)
  case timeout(String)

  var errorDescription: String? {
    switch self {
    case .invalidConfig(let message), .timeout(let message):
      return message
    }
  }
}

private func object(_ value: Any?, label: String) throws -> [String: Any] {
  guard let object = value as? [String: Any] else {
    throw BenchmarkError.invalidConfig("\(label) must be an object.")
  }
  return object
}

private func array(_ value: Any?, label: String) throws -> [Any] {
  guard let array = value as? [Any] else {
    throw BenchmarkError.invalidConfig("\(label) must be an array.")
  }
  return array
}

private func string(_ value: Any?, label: String) throws -> String {
  guard let string = value as? String, !string.isEmpty else {
    throw BenchmarkError.invalidConfig("\(label) must be a non-empty string.")
  }
  return string
}
