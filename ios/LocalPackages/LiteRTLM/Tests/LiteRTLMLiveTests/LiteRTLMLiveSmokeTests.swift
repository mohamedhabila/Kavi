import Foundation
@testable import LiteRTLM
import XCTest

final class LiteRTLMLiveSmokeTests: XCTestCase {
  func testReplyStopsAtTheTokenBudget() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let modelPath = nonEmpty(env["LITERTLM_LIVE_MODEL_PATH"]) else {
      throw XCTSkip("Set LITERTLM_LIVE_MODEL_PATH to run the LiteRT-LM live smoke test.")
    }
    let backendName = nonEmpty(env["LITERTLM_LIVE_BACKEND"]) ?? "cpu"
    let engine = Engine(
      engineConfig: try EngineConfig(
        modelPath: modelPath,
        backend: try backend(named: backendName),
        maxNumTokens: 4096,
        cacheDir: NSTemporaryDirectory()
      )
    )
    try await withTimeout(seconds: 180) { try await engine.initialize() }
    let conversation = try await engine.createConversation()

    let response = try await withTimeout(seconds: 180) {
      try await conversation.sendMessage(
        Message("Count from 1 to 300, one number per line, and write nothing else.", role: .user),
        maxOutputTokens: 16
      )
    }
    let numbers = response.toString.split(whereSeparator: { !$0.isNumber }).count
    // 16 tokens hold well under 20 numbers; without the cap the model counts on to 300.
    XCTAssertLessThanOrEqual(numbers, 20, "A 16-token reply listed \(numbers) numbers.")
  }

  func testDescribesAnImage() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let modelPath = nonEmpty(env["LITERTLM_LIVE_MODEL_PATH"]),
      let imagePath = nonEmpty(env["LITERTLM_LIVE_IMAGE_PATH"])
    else {
      throw XCTSkip("Set LITERTLM_LIVE_MODEL_PATH and LITERTLM_LIVE_IMAGE_PATH to run the image test.")
    }
    let backendName = nonEmpty(env["LITERTLM_LIVE_BACKEND"]) ?? "cpu"
    // The app runs the vision encoder on CPU (LocalLlmTypes), so the test does too.
    let engine = Engine(
      engineConfig: try EngineConfig(
        modelPath: modelPath,
        backend: try backend(named: backendName),
        visionBackend: .cpu(),
        maxNumTokens: 4096,
        cacheDir: NSTemporaryDirectory()
      )
    )
    try await withTimeout(seconds: 180) { try await engine.initialize() }
    let conversation = try await engine.createConversation()
    ExperimentalFlags.visualTokenBudget = 280

    let response = try await withTimeout(seconds: 180) {
      try await conversation.sendMessage(
        Message(
          contents: [.imageFile(imagePath), .text("What colour fills this image? Answer with one word.")],
          role: .user
        ),
        maxOutputTokens: 32
      )
    }
    let answer = response.toString.lowercased()
    let expected = nonEmpty(env["LITERTLM_LIVE_IMAGE_COLOUR"]) ?? "red"
    XCTAssertTrue(answer.contains(expected), "Expected \(expected); the model answered: \(answer)")
  }

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
      // Optional encoders, to measure what loading one costs.
      let visionBackend = try nonEmpty(env["LITERTLM_LIVE_VISION_BACKEND"]).map { try backend(named: $0) }
      let audioBackend = try nonEmpty(env["LITERTLM_LIVE_AUDIO_BACKEND"]).map { try backend(named: $0) }
      report["visionBackend"] = visionBackend?.rawValue ?? ""
      report["audioBackend"] = audioBackend?.rawValue ?? ""
      let engine = Engine(
        engineConfig: try EngineConfig(
          modelPath: modelPath,
          backend: try backend(named: backendName),
          visionBackend: visionBackend,
          audioBackend: audioBackend,
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
