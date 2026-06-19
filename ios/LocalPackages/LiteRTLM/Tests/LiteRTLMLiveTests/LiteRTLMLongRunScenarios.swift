import Foundation
@testable import LiteRTLM

func runMemoryRecallScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let marker = "KAVI-BENCH-7429"
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let start = Date()
  try await benchmarkWithTimeout(seconds: 180, label: "multi-turn-memory-recall") {
    _ = try await conversation.sendMessage(
      Message("Remember this benchmark marker: \(marker).", role: .user)
    )
    for turn in 1...6 {
      _ = try await conversation.sendMessage(
        Message("Continue turn \(turn) with a brief acknowledgement.", role: .user)
      )
    }
    let recall = try await conversation.sendMessage(Message("Return only the benchmark marker.", role: .user))
    guard recall.toString.contains(marker) else {
      throw BenchmarkError.invalidConfig("Local model did not recall the benchmark marker.")
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["conversationTurns"] = 8
  scenarioMetrics["memoryProbeCount"] = 1
  scenarioMetrics["memoryRecallPassed"] = true
  return passedScenario(
    "multi-turn-memory-recall",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runContextPressureScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let turns = max(config.conversationTurns, 20)
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  var estimatedInputTokens = 0
  let start = Date()
  try await benchmarkWithTimeout(seconds: TimeInterval(max(240, turns * 24)), label: "context-pressure-conversation") {
    for turn in 1...turns {
      let prompt = contextPressurePrompt(turn: turn)
      estimatedInputTokens += estimateTokens(prompt)
      _ = try await conversation.sendMessage(Message(prompt, role: .user))
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["conversationTurns"] = turns
  scenarioMetrics["inputTokens"] = estimatedInputTokens
  scenarioMetrics["inputBudgetTokens"] = 4096
  scenarioMetrics["contextPressureRatio"] = Double(estimatedInputTokens) / 4096.0
  scenarioMetrics["contextCompactionState"] = "full"
  return passedScenario(
    "context-pressure-conversation",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runErrorRecoveryScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let start = Date()
  var firstChunkMs: Int?
  try await benchmarkWithTimeout(seconds: 120, label: "error-recovery-after-cancel") {
    let cancellable = try await makeBenchmarkConversation(engine: engine, config: config)
    let streamTask = Task {
      for try await chunk in cancellable.sendMessageStream(
        Message("Produce a long response until cancellation.", role: .user)
      ) {
        if firstChunkMs == nil && !chunk.toString.isEmpty {
          firstChunkMs = benchmarkElapsedMs(since: start)
        }
        break
      }
    }
    try await Task.sleep(nanoseconds: 2_000_000_000)
    try? cancellable.cancel()
    _ = try? await streamTask.value

    let recovery = try await makeBenchmarkConversation(engine: engine, config: config)
    let response = try await recovery.sendMessage(
      Message("Reply with a brief acknowledgement.", role: .user)
    )
    guard !response.toString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw BenchmarkError.invalidConfig("Local model did not recover after cancellation.")
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["cancellationFirstChunkMs"] = firstChunkMs ?? NSNull()
  scenarioMetrics["recoveryCompleted"] = true
  return passedScenario(
    "error-recovery-after-cancel",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runBackgroundForegroundScenario(
  engine: Engine,
  config: LiteRTLMBenchmarkConfig,
  metrics: [String: Any]
) async throws -> LiteRTLMBenchmarkScenarioResult {
  let conversation = try await makeBenchmarkConversation(engine: engine, config: config)
  let start = Date()
  try await benchmarkWithTimeout(seconds: 120, label: "background-foreground-interruption") {
    _ = try await conversation.sendMessage(
      Message("Prepare for a brief mobile lifecycle interruption.", role: .user)
    )
    try await Task.sleep(nanoseconds: 750_000_000)
    let response = try await conversation.sendMessage(
      Message("Reply after the lifecycle interruption.", role: .user)
    )
    guard !response.toString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw BenchmarkError.invalidConfig("Local model did not resume after lifecycle interruption.")
    }
  }

  var scenarioMetrics = metrics
  scenarioMetrics["backgroundForegroundCompleted"] = true
  scenarioMetrics["lifecycleInterruptionMode"] = "xctest-idle"
  return passedScenario(
    "background-foreground-interruption",
    durationMs: benchmarkElapsedMs(since: start),
    metrics: scenarioMetrics
  )
}

func runNativeToolScenario(config: LiteRTLMBenchmarkConfig) async -> LiteRTLMBenchmarkScenarioResult {
  if !config.modelSupportsTools {
    return skippedScenario(
      "native-tool-call",
      reason: "Selected installed model has no declared tool capability."
    )
  }

  let start = Date()
  do {
    try await benchmarkWithTimeout(seconds: 120, label: "native-tool-call") {
      ExperimentalFlags.enableConversationConstrainedDecoding = true
      let engineConfig = try EngineConfig(
        modelPath: config.modelPath,
        backend: try benchmarkBackend(named: config.backend),
        maxNumTokens: 4096,
        cacheDir: NSTemporaryDirectory()
      )
      let engine = Engine(engineConfig: engineConfig)
      try await engine.initialize()
      let conversation = try await engine.createConversation(
        with: ConversationConfig(
          tools: [
            ToolDefinition(
              name: "get_current_weather",
              description: "Get current weather for a city.",
              parameters: [
                "type": "object",
                "properties": [
                  "city": [
                    "type": "string",
                    "description": "City name.",
                  ],
                ],
                "required": ["city"],
              ]
            ),
          ],
          samplerConfig: try benchmarkSamplerConfig(for: config)
        )
      )
      let response = try await conversation.sendMessage(
        Message("Use the available tool to check the current weather in Paris.", role: .user)
      )
      guard response.toolCalls.contains(where: { $0.name == "get_current_weather" }) else {
        throw BenchmarkError.invalidConfig("Tool-capable local model did not emit a native tool call.")
      }
    }

    var scenarioMetrics = metricsForNativeToolScenario(config: config)
    scenarioMetrics["toolCallDetected"] = true
    return passedScenario(
      "native-tool-call",
      durationMs: benchmarkElapsedMs(since: start),
      metrics: scenarioMetrics
    )
  } catch {
    return failedScenario(
      "native-tool-call",
      metrics: metricsForNativeToolScenario(config: config),
      error: error
    )
  }
}

private func metricsForNativeToolScenario(config: LiteRTLMBenchmarkConfig) -> [String: Any] {
  [
    "activeBackend": config.backend,
    "modelSupportsTools": config.modelSupportsTools,
    "constrainedDecodingEnabled": true,
  ]
}

private func contextPressurePrompt(turn: Int) -> String {
  let marker = String(repeating: "context-pressure-marker-\(turn) ", count: min(turn * 2, 48))
  return "Turn \(turn). Continue the same conversation and reply with OK after reading the context. \(marker)"
}
