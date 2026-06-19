package com.kavi.mobile

import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.Message
import org.json.JSONObject

fun runOnDeviceContextPressureScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
  createConversation: (Engine, OnDeviceBenchmarkConfig) -> Conversation,
): OnDeviceBenchmarkScenarioResult {
  val conversation = createConversation(engine, config)
  val turns = config.conversationTurns.coerceAtLeast(20)
  var estimatedInputTokens = 0
  try {
    val durationMs = timedOnDeviceMillis {
      for (turn in 1..turns) {
        val payload = buildOnDeviceContextPressurePrompt(turn)
        estimatedInputTokens += estimateOnDeviceBenchmarkTextTokens(payload)
        conversation.sendMessage(Message.user(payload))
      }
    }
    return passedOnDeviceScenario(
      "context-pressure-conversation",
      durationMs,
      metrics.copyJson()
        .put("conversationTurns", turns)
        .put("inputTokens", estimatedInputTokens)
        .put("inputBudgetTokens", 4096)
        .put("contextPressureRatio", estimatedInputTokens.toDouble() / 4096.0)
        .put("contextCompactionState", "full")
        .put("conversationCacheHits", 0)
        .put("conversationCacheMisses", 1),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

private fun buildOnDeviceContextPressurePrompt(turn: Int): String {
  val marker = "context-pressure-marker-$turn "
  return "Turn $turn. Continue the same conversation and reply with OK after reading the context. " +
    marker.repeat((turn * 2).coerceAtMost(48))
}

private fun estimateOnDeviceBenchmarkTextTokens(text: String): Int {
  return (text.length + 3) / 4
}
