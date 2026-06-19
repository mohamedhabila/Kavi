import Darwin
import Foundation
@testable import LiteRTLM

struct LiteRTLMBenchmarkScenarioResult {
  let id: String
  let status: String
  let durationMs: Int?
  let metrics: [String: Any]
  let error: String?

  func jsonObject() -> [String: Any] {
    [
      "id": id,
      "status": status,
      "durationMs": durationMs ?? NSNull(),
      "metrics": metrics,
      "error": error ?? NSNull(),
    ]
  }
}

func passedScenario(
  _ id: String,
  durationMs: Int?,
  metrics: [String: Any]
) -> LiteRTLMBenchmarkScenarioResult {
  LiteRTLMBenchmarkScenarioResult(
    id: id,
    status: "passed",
    durationMs: durationMs,
    metrics: metrics,
    error: nil
  )
}

func skippedScenario(_ id: String, reason: String) -> LiteRTLMBenchmarkScenarioResult {
  LiteRTLMBenchmarkScenarioResult(
    id: id,
    status: "skipped",
    durationMs: nil,
    metrics: [:],
    error: reason
  )
}

func failedScenario(
  _ id: String,
  metrics: [String: Any],
  error: Error
) -> LiteRTLMBenchmarkScenarioResult {
  var failedMetrics = metrics
  failedMetrics["nativeCrashed"] = false
  failedMetrics["nativeErrorType"] = String(describing: type(of: error))
  failedMetrics["nativeErrorMessage"] = error.localizedDescription
  return LiteRTLMBenchmarkScenarioResult(
    id: id,
    status: "failed",
    durationMs: nil,
    metrics: failedMetrics,
    error: error.localizedDescription
  )
}

func baseMetrics(
  config: LiteRTLMBenchmarkConfig,
  memoryBeforeMb: Double?,
  memoryAfterMb: Double?,
  engineInitMs: Int?
) -> [String: Any] {
  [
    "engineInitMs": engineInitMs ?? NSNull(),
    "ttftMs": NSNull(),
    "decodeTokensPerSecond": NSNull(),
    "outputTokens": NSNull(),
    "activeBackend": config.backend,
    "backendFallbackCount": 0,
    "backendFallbackReason": NSNull(),
    "nativeCrashed": false,
    "nativeErrorType": NSNull(),
    "nativeErrorMessage": NSNull(),
    "conversationCacheHits": 0,
    "conversationCacheMisses": 1,
    "memoryBeforeMb": memoryBeforeMb ?? NSNull(),
    "memoryAfterMb": memoryAfterMb ?? NSNull(),
    "contextWindowTokens": 4096,
    "inputTokens": NSNull(),
    "inputBudgetTokens": NSNull(),
    "contextPressureRatio": NSNull(),
    "contextCompactionState": "full",
    "constrainedDecodingEnabled": false,
    "speculativeDecodingSupported": false,
    "speculativeDecodingEnabled": false,
    "capabilityCheckFailed": false,
  ]
}

func benchmarkBackend(named name: String) throws -> Backend {
  guard let backend = Backend(rawValue: name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) else {
    throw BenchmarkError.invalidConfig("Unsupported iOS LiteRT-LM backend: \(name)")
  }
  return backend
}

func benchmarkSamplerConfig(for config: LiteRTLMBenchmarkConfig) throws -> SamplerConfig? {
  config.backend.lowercased() == "cpu"
    ? try SamplerConfig(topK: 20, topP: 0.8, temperature: 0.2)
    : nil
}

func benchmarkElapsedMs(since start: Date) -> Int {
  Int(Date().timeIntervalSince(start) * 1000)
}

func currentMemoryMb() -> Double? {
  var info = mach_task_basic_info()
  var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
  let result = withUnsafeMutablePointer(to: &info) { pointer in
    pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
    }
  }
  guard result == KERN_SUCCESS else {
    return nil
  }
  return Double(info.resident_size) / 1_048_576.0
}

func estimateTokens(_ text: String) -> Int {
  (text.count + 3) / 4
}

func benchmarkWithTimeout<T>(
  seconds: TimeInterval,
  label: String,
  operation: @escaping () async throws -> T
) async throws -> T {
  try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask { try await operation() }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
      throw BenchmarkError.timeout("\(label) timed out after \(Int(seconds))s.")
    }
    guard let result = try await group.next() else {
      throw BenchmarkError.timeout("\(label) finished without a result.")
    }
    group.cancelAll()
    return result
  }
}
