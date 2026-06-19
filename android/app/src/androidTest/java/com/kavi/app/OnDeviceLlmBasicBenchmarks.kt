package com.kavi.mobile

import android.content.Context
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.Message
import kotlinx.coroutines.channels.consumeEach
import kotlinx.coroutines.flow.produceIn
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.File

fun runOnDeviceAvailabilityScenario(
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
): OnDeviceBenchmarkScenarioResult {
  val modelFile = File(config.modelPath)
  return if (modelFile.exists() && modelFile.length() > 0) {
    passedOnDeviceScenario("local-model-availability", 0, metrics.copyJson())
  } else {
    failedOnDeviceScenario(
      "local-model-availability",
      metrics,
      IllegalStateException("Model file does not exist or is empty: ${config.modelPath}"),
    )
  }
}

fun runOnDeviceWarmupScenario(
  context: Context,
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  val startMemory = readOnDeviceProcessMemoryMb(context)
  try {
    val durationMs = timedOnDeviceMillis {
      conversation.sendMessage(Message.user("Reply with OK."))
    }
    return passedOnDeviceScenario(
      "local-model-warmup",
      durationMs,
      metrics.copyJson()
        .put("memoryBeforeMb", startMemory ?: JSONObject.NULL)
        .put("memoryAfterMb", readOnDeviceProcessMemoryMb(context) ?: JSONObject.NULL),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

suspend fun runOnDeviceStreamingScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  var firstChunkMs: Long? = null
  var chunkCount = 0
  val start = System.currentTimeMillis()
  try {
    val durationMs = timedOnDeviceMillisSuspend {
      withTimeout(60_000L) {
        val stream = conversation.sendMessageAsync(Message.user("Reply with exactly OK.")).produceIn(this)
        try {
          stream.consumeEach { message ->
            if (firstChunkMs == null && extractOnDeviceText(message).isNotBlank()) {
              firstChunkMs = System.currentTimeMillis() - start
            }
            chunkCount += 1
          }
        } finally {
          stream.cancel()
        }
      }
    }

    return passedOnDeviceScenario(
      "single-turn-streaming",
      durationMs,
      metrics.copyJson()
        .put("ttftMs", firstChunkMs ?: JSONObject.NULL)
        .put("decodeTokensPerSecond", JSONObject.NULL)
        .put("outputTokens", JSONObject.NULL)
        .put("chunkCount", chunkCount),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

suspend fun runOnDeviceCancellationScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  var firstChunkMs: Long? = null
  val startedAt = System.currentTimeMillis()
  try {
    val durationMs = timedOnDeviceMillisSuspend {
      withTimeout(30_000L) {
        val stream = conversation
          .sendMessageAsync(Message.user("Count upward slowly and stop only when cancelled."))
          .produceIn(this)
        try {
          firstChunkMs = withTimeoutOrNull(10_000L) {
            stream.receive()
            System.currentTimeMillis() - startedAt
          }
          cancelOnDeviceConversation(conversation)
        } finally {
          stream.cancel()
        }
      }
    }

    return passedOnDeviceScenario(
      "cancel-mid-stream",
      durationMs,
      metrics.copyJson()
        .put("activeBackend", config.backend)
        .put("nativeCrashed", false)
        .put("cancellationFirstChunkMs", firstChunkMs ?: JSONObject.NULL),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

fun runOnDeviceConversationScenario(
  scenarioId: String,
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
  turns: Int,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  try {
    val durationMs = timedOnDeviceMillis {
      for (turn in 1..turns) {
        conversation.sendMessage(Message.user("Turn $turn. Reply with OK."))
      }
    }
    return passedOnDeviceScenario(
      scenarioId,
      durationMs,
      metrics.copyJson()
        .put("conversationTurns", turns)
        .put("conversationCacheHits", 0)
        .put("conversationCacheMisses", 1),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}
