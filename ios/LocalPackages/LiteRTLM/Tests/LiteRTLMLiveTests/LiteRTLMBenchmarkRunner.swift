import Foundation
@testable import LiteRTLM

struct LiteRTLMBenchmarkRunner {
  let config: LiteRTLMBenchmarkConfig

  func run() async -> [LiteRTLMBenchmarkScenarioResult] {
    var results: [LiteRTLMBenchmarkScenarioResult] = []
    let memoryBefore = currentMemoryMb()
    let engine: Engine
    let engineInitMs: Int

    do {
      engine = Engine(
        engineConfig: try EngineConfig(
          modelPath: config.modelPath,
          backend: try benchmarkBackend(named: config.backend),
          maxNumTokens: 4096,
          cacheDir: NSTemporaryDirectory()
        )
      )
      let initStart = Date()
      try await benchmarkWithTimeout(seconds: 180, label: "engine-initialize") {
        try await engine.initialize()
      }
      engineInitMs = benchmarkElapsedMs(since: initStart)
    } catch {
      let metrics = baseMetrics(
        config: config,
        memoryBeforeMb: memoryBefore,
        memoryAfterMb: currentMemoryMb(),
        engineInitMs: nil
      )
      let scenarioId = config.scenarioIds.first ?? "local-model-availability"
      return [failedScenario(scenarioId, metrics: metrics, error: error)]
    }

    let metrics = baseMetrics(
      config: config,
      memoryBeforeMb: memoryBefore,
      memoryAfterMb: currentMemoryMb(),
      engineInitMs: engineInitMs
    )

    do {
      if config.shouldRun("local-model-availability") {
        results.append(runAvailabilityScenario(config: config, metrics: metrics))
      }
      if config.shouldRun("local-model-warmup") {
        results.append(try await runWarmupScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("single-turn-streaming") {
        results.append(try await runStreamingScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("cancel-mid-stream") {
        results.append(try await runCancellationScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("twenty-turn-conversation") {
        results.append(
          try await runConversationScenario(
            id: "twenty-turn-conversation",
            turns: max(config.conversationTurns, 1),
            engine: engine,
            config: config,
            metrics: metrics
          )
        )
      }
      if config.shouldRun("fifty-turn-conversation") {
        results.append(
          try await runConversationScenario(
            id: "fifty-turn-conversation",
            turns: 50,
            engine: engine,
            config: config,
            metrics: metrics
          )
        )
      }
      if config.shouldRun("multi-turn-memory-recall") {
        results.append(try await runMemoryRecallScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("context-pressure-conversation") {
        results.append(try await runContextPressureScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("error-recovery-after-cancel") {
        results.append(try await runErrorRecoveryScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("background-foreground-interruption") {
        results.append(try await runBackgroundForegroundScenario(engine: engine, config: config, metrics: metrics))
      }
      if config.shouldRun("backend-fallback") {
        results.append(skippedScenario("backend-fallback", reason: "No synthetic backend failure is injected."))
      }
      if config.shouldRun("native-tool-call") {
        results.append(await runNativeToolScenario(config: config))
      }
    } catch {
      let failedId = config.scenarioIds.first { id in
        !results.contains { $0.id == id }
      } ?? "single-turn-streaming"
      results.append(failedScenario(failedId, metrics: metrics, error: error))
    }

    return results
  }
}
