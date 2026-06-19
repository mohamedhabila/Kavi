package com.kavi.mobile

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import org.json.JSONObject

class OnDeviceLlmBenchmarkRunner(
  private val context: Context,
) {
  suspend fun run(config: OnDeviceBenchmarkConfig): List<OnDeviceBenchmarkScenarioResult> {
    val results = mutableListOf<OnDeviceBenchmarkScenarioResult>()
    var engine: Engine? = null
    val memoryBefore = readOnDeviceProcessMemoryMb(context)
    val accelerationState = resolveOnDeviceAccelerationState(config)
    val engineInitMs = timedOnDeviceMillis {
      engine = createEngine(config, accelerationState)
    }
    val baseMetrics = baseOnDeviceMetrics(
      config,
      memoryBefore,
      readOnDeviceProcessMemoryMb(context),
      accelerationState,
    )
      .put("engineInitMs", engineInitMs)

    try {
      if (shouldRun(config, "local-model-availability")) {
        results.add(runOnDeviceAvailabilityScenario(config, baseMetrics))
      }
      if (shouldRun(config, "local-model-warmup")) {
        results.add(
          runOnDeviceWarmupScenario(
            context,
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "single-turn-streaming")) {
        results.add(
          runOnDeviceStreamingScenario(requireNotNull(engine), config, baseMetrics, ::createConversation),
        )
      }
      if (shouldRun(config, "cancel-mid-stream")) {
        results.add(
          runOnDeviceCancellationScenario(requireNotNull(engine), config, baseMetrics, ::createConversation),
        )
      }
      if (shouldRun(config, "twenty-turn-conversation")) {
        results.add(
          runOnDeviceConversationScenario(
            "twenty-turn-conversation",
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
            config.conversationTurns.coerceAtLeast(1),
          ),
        )
      }
      if (shouldRun(config, "fifty-turn-conversation")) {
        results.add(
          runOnDeviceFiftyTurnConversationScenario(
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "multi-turn-memory-recall")) {
        results.add(
          runOnDeviceMemoryRecallScenario(
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "context-pressure-conversation")) {
        results.add(
          runOnDeviceContextPressureScenario(
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "error-recovery-after-cancel")) {
        results.add(
          runOnDeviceErrorRecoveryScenario(
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "background-foreground-interruption")) {
        results.add(
          runOnDeviceBackgroundForegroundScenario(
            context,
            requireNotNull(engine),
            config,
            baseMetrics,
            ::createConversation,
          ),
        )
      }
      if (shouldRun(config, "backend-fallback")) {
        results.add(skippedOnDeviceScenario("backend-fallback", "No synthetic backend failure is injected."))
      }
      if (shouldRun(config, "native-tool-call")) {
        results.add(
          runOnDeviceNativeToolScenario(
            requireNotNull(engine),
            config,
            baseMetrics,
          ),
        )
      }
    } catch (error: Throwable) {
      val failedScenarioId = config.scenarioIds.firstOrNull { scenarioId ->
        results.none { result -> result.id == scenarioId }
      } ?: "single-turn-streaming"
      results.add(failedOnDeviceScenario(failedScenarioId, baseMetrics, error))
    } finally {
      closeOnDeviceEngine(engine)
    }

    return results
  }

  private fun shouldRun(config: OnDeviceBenchmarkConfig, scenarioId: String): Boolean {
    return config.scenarioIds.isEmpty() || config.scenarioIds.contains(scenarioId)
  }

  private fun createEngine(
    config: OnDeviceBenchmarkConfig,
    accelerationState: OnDeviceAccelerationState,
  ): Engine {
    return withOnDeviceExperimentalFlags(accelerationState) {
      val engine = Engine(
        EngineConfig(
          modelPath = config.modelPath,
          backend = resolveBackend(config.backend),
          maxNumTokens = 4096,
        ),
      )
      try {
        engine.initialize()
        engine
      } catch (error: Throwable) {
        closeOnDeviceEngine(engine)
        throw error
      }
    }
  }

  private fun createConversation(engine: Engine, config: OnDeviceBenchmarkConfig): Conversation {
    val samplerConfig = if (isOnDeviceNpuAccelerator(config.backend)) {
      null
    } else {
      SamplerConfig(
        topK = 20,
        topP = 0.8,
        temperature = 0.2,
      )
    }
    return engine.createConversation(
      ConversationConfig(
        samplerConfig = samplerConfig,
      ),
    )
  }

  private fun resolveBackend(backend: String): Backend {
    return when (backend.lowercase()) {
      "gpu" -> Backend.GPU()
      "npu", "tpu" -> Backend.NPU(nativeLibraryDir = context.applicationInfo.nativeLibraryDir)
      else -> Backend.CPU()
    }
  }
}
