package com.kavi.mobile

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.Message
import kotlinx.coroutines.flow.produceIn
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

fun runOnDeviceFiftyTurnConversationScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  return runOnDeviceConversationScenario(
    "fifty-turn-conversation",
    engine,
    config,
    metrics,
    createConversation,
    50,
  )
}

fun runOnDeviceMemoryRecallScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val marker = "KAVI-BENCH-7429"
  val conversation = createConversation(engine, config)
  try {
    val durationMs = timedOnDeviceMillis {
      conversation.sendMessage(Message.user("Remember this benchmark marker: $marker."))
      for (turn in 1..6) {
        conversation.sendMessage(Message.user("Continue turn $turn with a brief acknowledgement."))
      }
      val recall = conversation.sendMessage(Message.user("Return only the benchmark marker."))
      check(extractOnDeviceText(recall).contains(marker)) {
        "Local model did not recall the benchmark marker."
      }
    }
    return passedOnDeviceScenario(
      "multi-turn-memory-recall",
      durationMs,
      metrics.copyJson()
        .put("conversationTurns", 8)
        .put("memoryProbeCount", 1)
        .put("memoryRecallPassed", true),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

suspend fun runOnDeviceErrorRecoveryScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  var firstChunkMs: Long? = null
  val durationMs = timedOnDeviceMillisSuspend {
    val cancellable = createConversation(engine, config)
    val startedAt = System.currentTimeMillis()
    try {
      withTimeout(30_000L) {
        val stream = cancellable
          .sendMessageAsync(Message.user("Produce a long response until cancellation."))
          .produceIn(this)
        try {
          firstChunkMs = withTimeoutOrNull(10_000L) {
            stream.receive()
            System.currentTimeMillis() - startedAt
          }
          cancelOnDeviceConversation(cancellable)
        } finally {
          stream.cancel()
        }
      }
    } finally {
      closeOnDeviceConversation(cancellable)
    }

    val recoveryConversation = createConversation(engine, config)
    try {
      val response = recoveryConversation.sendMessage(Message.user("Reply with a brief acknowledgement."))
      check(extractOnDeviceText(response).isNotBlank()) {
        "Local model did not recover after cancellation."
      }
    } finally {
      closeOnDeviceConversation(recoveryConversation)
    }
  }

  return passedOnDeviceScenario(
    "error-recovery-after-cancel",
    durationMs,
    metrics.copyJson()
      .put("cancellationFirstChunkMs", firstChunkMs ?: JSONObject.NULL)
      .put("recoveryCompleted", true),
  )
}

fun runOnDeviceBackgroundForegroundScenario(
  context: Context,
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  try {
    val durationMs = timedOnDeviceMillis {
      conversation.sendMessage(Message.user("Prepare for a brief mobile lifecycle interruption."))
      moveBenchmarkAppThroughBackgroundForeground(context)
      val response = conversation.sendMessage(Message.user("Reply after the lifecycle interruption."))
      check(extractOnDeviceText(response).isNotBlank()) {
        "Local model did not resume after background and foreground transitions."
      }
    }
    return passedOnDeviceScenario(
      "background-foreground-interruption",
      durationMs,
      metrics.copyJson().put("backgroundForegroundCompleted", true),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

private fun moveBenchmarkAppThroughBackgroundForeground(context: Context) {
  context.startActivity(
    Intent(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_HOME)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
  )
  SystemClock.sleep(500L)

  val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
  requireNotNull(launchIntent) { "No launch intent found for ${context.packageName}." }
  context.startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  SystemClock.sleep(500L)
}
