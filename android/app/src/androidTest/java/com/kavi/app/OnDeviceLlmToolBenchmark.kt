package com.kavi.mobile

import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.tool
import org.json.JSONObject

fun runOnDeviceNativeToolScenario(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
  metrics: JSONObject,
): OnDeviceBenchmarkScenarioResult {
  if (!config.modelSupportsTools) {
    return skippedOnDeviceScenario(
      "native-tool-call",
      "Selected installed model has no declared tool capability.",
    )
  }

  val conversation = createToolConversation(engine, config)
  var toolCallCount = 0
  try {
    val durationMs = timedOnDeviceMillis {
      val toolRequest = conversation.sendMessage(
        Message.user("Use the available benchmark data source to answer the weather for Paris."),
      )
      toolCallCount = toolRequest.toolCalls.size
      check(toolCallCount > 0) { "Native model did not return a structured tool call." }

      val toolResponses = toolRequest.toolCalls.map { toolCall ->
        Content.ToolResponse(
          toolCall.name,
          mapOf("city" to "Paris", "temperatureC" to 17, "condition" to "clear"),
        )
      }
      val finalMessage = conversation.sendMessage(Message.tool(Contents.of(toolResponses)))
      check(extractOnDeviceText(finalMessage).isNotBlank()) {
        "Native model did not continue after the manual tool response."
      }
    }

    return passedOnDeviceScenario(
      "native-tool-call",
      durationMs,
      metrics.copyJson()
        .put("constrainedDecodingEnabled", true)
        .put("nativeToolCallCount", toolCallCount)
        .put("manualToolRoundTripCompleted", true),
    )
  } finally {
    closeOnDeviceConversation(conversation)
  }
}

private fun createToolConversation(
  engine: Engine,
  config: OnDeviceBenchmarkConfig,
): Conversation {
  return withOnDeviceExperimentalFlags(resolveOnDeviceAccelerationState(config, true)) {
    engine.createConversation(
      ConversationConfig(
        tools = listOf(tool(BenchmarkWeatherTool())),
        automaticToolCalling = false,
      ),
    )
  }
}

private class BenchmarkWeatherTool : OpenApiTool {
  override fun getToolDescriptionJsonString(): String {
    return JSONObject()
      .put("name", "lookup_benchmark_weather")
      .put("description", "Return the benchmark weather data for a city.")
      .put(
        "parameters",
        JSONObject()
          .put("type", "object")
          .put("properties", JSONObject().put("city", JSONObject().put("type", "string")))
          .put("required", listOf("city")),
      )
      .toString()
  }

  override fun execute(paramsJsonString: String): String {
    return JSONObject()
      .put("city", "Paris")
      .put("temperatureC", 17)
      .put("condition", "clear")
      .toString()
  }
}
