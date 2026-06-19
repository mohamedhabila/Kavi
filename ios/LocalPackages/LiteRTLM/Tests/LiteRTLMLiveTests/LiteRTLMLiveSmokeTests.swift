import Foundation
@testable import LiteRTLM
import XCTest

final class LiteRTLMLiveSmokeTests: XCTestCase {
  func testGenerateWithConfiguredModel() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let modelPath = nonEmpty(env["LITERTLM_LIVE_MODEL_PATH"]) else {
      throw XCTSkip("Set LITERTLM_LIVE_MODEL_PATH to run the LiteRT-LM live smoke test.")
    }

    let backendName = nonEmpty(env["LITERTLM_LIVE_BACKEND"]) ?? "cpu"
    let prompt = nonEmpty(env["LITERTLM_LIVE_PROMPT"])
      ?? "Respond briefly to confirm this local model is running."
    let timeoutSeconds = positiveDouble(env["LITERTLM_LIVE_TIMEOUT_SECONDS"]) ?? 180
    let maxNumTokens = positiveInt(env["LITERTLM_LIVE_CONTEXT_TOKENS"]) ?? 4096
    let reportPath = nonEmpty(env["LITERTLM_LIVE_REPORT_PATH"])

    var report: [String: Any] = [
      "platform": "ios",
      "runtime": "litert-lm",
      "modelPath": modelPath,
      "backend": backendName,
      "contextWindowTokens": maxNumTokens,
      "simulatorDeviceName": env["SIMULATOR_DEVICE_NAME"] ?? "",
      "simulatorRuntimeVersion": env["SIMULATOR_RUNTIME_VERSION"] ?? "",
    ]

    defer {
      try? writeReport(report, to: reportPath)
    }

    do {
      let engine = Engine(
        engineConfig: try EngineConfig(
          modelPath: modelPath,
          backend: try backend(named: backendName),
          maxNumTokens: maxNumTokens,
          cacheDir: NSTemporaryDirectory()
        )
      )

      let initStart = Date()
      try await withTimeout(seconds: timeoutSeconds) {
        try await engine.initialize()
      }
      report["engineInitMs"] = elapsedMs(since: initStart)

      let conversation = try await engine.createConversation()
      let generateStart = Date()
      let response = try await withTimeout(seconds: timeoutSeconds) {
        try await conversation.sendMessage(Message(prompt, role: .user))
      }
      let text = response.toString.trimmingCharacters(in: .whitespacesAndNewlines)
      report["generateMs"] = elapsedMs(since: generateStart)
      report["outputCharacters"] = text.count
      report["nonEmptyOutput"] = !text.isEmpty
      report["status"] = "passed"

      XCTAssertFalse(text.isEmpty, "LiteRT-LM returned an empty response.")
    } catch {
      report["status"] = "failed"
      report["error"] = String(describing: error)
      throw error
    }
  }
}

private func nonEmpty(_ value: String?) -> String? {
  guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  return trimmed
}

private func positiveInt(_ value: String?) -> Int? {
  guard let value = nonEmpty(value), let parsed = Int(value), parsed > 0 else {
    return nil
  }
  return parsed
}

private func positiveDouble(_ value: String?) -> TimeInterval? {
  guard let value = nonEmpty(value), let parsed = TimeInterval(value), parsed > 0 else {
    return nil
  }
  return parsed
}

private func backend(named name: String) throws -> Backend {
  switch name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
  case "cpu":
    return .cpu()
  case "gpu":
    return .gpu
  default:
    throw NSError(
      domain: "LiteRTLMLiveSmokeTests",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Unsupported LiteRT-LM live smoke backend: \(name)"]
    )
  }
}

private func elapsedMs(since start: Date) -> Int {
  Int(Date().timeIntervalSince(start) * 1000)
}

private func withTimeout<T>(
  seconds: TimeInterval,
  operation: @escaping () async throws -> T
) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask {
      try await operation()
    }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      throw NSError(
        domain: "LiteRTLMLiveSmokeTests",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "LiteRT-LM live smoke timed out after \(seconds)s."]
      )
    }

    guard let result = try await group.next() else {
      throw NSError(
        domain: "LiteRTLMLiveSmokeTests",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "LiteRT-LM live smoke finished without a result."]
      )
    }
    group.cancelAll()
    return result
  }
}

private func writeReport(_ report: [String: Any], to path: String?) throws {
  guard let path else {
    return
  }
  let url = URL(fileURLWithPath: path)
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: url, options: [.atomic])
}
