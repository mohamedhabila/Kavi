import Foundation
@testable import LiteRTLM

func makeBenchmarkConversation(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig
) async throws -> Conversation {
  try await engine.createConversation(
    with: ConversationConfig(samplerConfig: try benchmarkSamplerConfig(for: config))
  )
}

func runAvailabilityScenario(
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) -> LiteRTLMBenchmarkScenarioResult {
  let modelUrl = URL(fileURLWithPath: config.modelPath)
  let fileSize = (try? modelUrl.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  guard FileManager.default.fileExists(atPath: config.modelPath), fileSize > 0 else {
    return failedScenario(
      "local-model-availability",
      metrics: metrics,
      error: BenchmarkError.invalidConfig("Model file does not exist or is empty: \(config.modelPath)")
    )
  }
  var scenarioMetrics = metrics
  scenarioMetrics["modelFileBytes"] = fileSize
  return passedScenario("local-model-availability", durationMs: 0, metrics: scenarioMetrics)
}

func runWarmupScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let memoryBefore = currentMemoryMb()
  let start = Date()
  _ = try await benchmarkWithTimeout(seconds: 120, label: "local-model-warmup") {
    try await conversation.sendMessage(Message("Reply with OK.", role: .user))
  }
  var scenarioMetrics = metrics
  scenarioMetrics["memoryBeforeMb"] = memoryBefore ?? NSNull()
  scenarioMetrics["memoryAfterMb"] = currentMemoryMb() ?? NSNull()
  return passedScenario(
    "local-model-warmup",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runStreamingScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let start = Date()
  var firstChunkMs: Int?
  var chunkCount = 0
  var output = ""

  try await benchmarkWithTimeout(seconds: 120, label: "single-turn-streaming") {
    for try await chunk in conversation.sendMessageStream(Message("Reply with exactly OK.", role: .user)) {
      let text = chunk.toString
      if firstChunkMs == nil && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        firstChunkMs = benchmarkElapsedMs(since: start)
      }
      output += text
      chunkCount += 1
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["ttftMs"] = firstChunkMs ?? NSNull()
  scenarioMetrics["chunkCount"] = chunkCount
  scenarioMetrics["outputCharacters"] = output.count
  return passedScenario(
    "single-turn-streaming",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runCancellationScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let start = Date()
  var firstChunkMs: Int?

  try await benchmarkWithTimeout(seconds: 60, label: "cancel-mid-stream") {
    let streamTask = Task {
      for try await chunk in conversation.sendMessageStream(
        Message("Count upward slowly and stop only when cancelled.", role: .user)
      ) {
        if firstChunkMs == nil && !chunk.toString.isEmpty {
          firstChunkMs = benchmarkElapsedMs(since: start)
        }
        break
      }
    }
    try await Task.sleep(nanoseconds: 2_000_000_000)
    try? conversation.cancel()
    _ = try? await streamTask.value
  }

  var scenarioMetrics = metrics
  scenarioMetrics["cancellationFirstChunkMs"] = firstChunkMs ?? NSNull()
  return passedScenario(
    "cancel-mid-stream",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runConversationScenario(
  id: String,
  turns: Int,
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let start = Date()
  try await benchmarkWithTimeout(seconds: TimeInterval(max(120, turns * 20)), label: id) {
    for turn in 1...turns {
      _ = try await conversation.sendMessage(Message("Turn \(turn). Reply with OK.", role: .user))
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["conversationTurns"] = turns
  return passedScenario(id, durationMs: benchmarkElapsedMs(since: start), metrics: scenarioMetrics)
}
