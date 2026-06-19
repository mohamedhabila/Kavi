import Foundation
import XCTest

final class LiteRTLMBenchmarkTests: XCTestCase {
  func testRunConfiguredBenchmarkPlan() async throws {
    let env = ProcessInfo.processInfo.environment
    guard let planPath = nonEmptyBenchmarkEnv(env["LITERTLM_BENCHMARK_PLAN_PATH"]) else {
      throw XCTSkip("Set LITERTLM_BENCHMARK_PLAN_PATH to run the LiteRT-LM benchmark plan.")
    }
    guard let reportPath = nonEmptyBenchmarkEnv(env["LITERTLM_BENCHMARK_REPORT_PATH"]) else {
      throw XCTSkip("Set LITERTLM_BENCHMARK_REPORT_PATH to run the LiteRT-LM benchmark plan.")
    }

    let config = try LiteRTLMBenchmarkConfig.read(from: planPath)
    let results = await LiteRTLMBenchmarkRunner(config: config).run()
    try writeBenchmarkReport(config: config, results: results, to: reportPath)

    let failedRequired = results.filter { result in
      config.scenarioIds.contains(result.id) && result.status == "failed"
    }
    XCTAssertTrue(failedRequired.isEmpty, "iOS LiteRT-LM benchmark failed: \(failedRequired)")
  }
}

private func writeBenchmarkReport(
  config: LiteRTLMBenchmarkConfig,
  results: [LiteRTLMBenchmarkScenarioResult],
  to path: String
) throws {
  let report: [String: Any] = [
    "device": [
      "deviceId": config.deviceId ?? ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "ios-simulator",
    ],
    "model": [
      "modelId": config.modelId,
      "modelPath": config.modelPath,
      "runtime": config.runtime,
      "backend": config.backend,
      "capabilities": ["tools": config.modelSupportsTools],
    ],
    "scenarios": results.map { $0.jsonObject() },
  ]
  let url = URL(fileURLWithPath: path)
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: url, options: [.atomic])
}

private func nonEmptyBenchmarkEnv(_ value: String?) -> String? {
  guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  return trimmed
}
