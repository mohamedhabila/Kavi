package com.kavi.mobile.localllm

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap

internal class LocalLlmRequestParser {
  fun parseRequest(request: ReadableMap): LocalRequest {
    val requestId = request.getString("requestId")?.trim().orEmpty()
    val modelPath = request.getString("modelPath")?.trim().orEmpty()
    val prompt = request.getString("prompt")?.trim()?.takeIf { it.isNotEmpty() }
    val currentMessage = if (request.hasKey("currentMessage") && !request.isNull("currentMessage")) {
      parseConversationMessage(request.getMap("currentMessage"))
    } else {
      null
    }
    val sampling = parseSampling(request)

    require(requestId.isNotEmpty()) { "requestId is required." }
    require(modelPath.isNotEmpty()) { "modelPath is required." }
    require(prompt != null || currentMessage != null) { "prompt or currentMessage is required." }
    validateSampling(sampling)

    return LocalRequest(
      requestId = requestId,
      conversationKey = request.getString("conversationKey")?.trim()?.takeIf { it.isNotEmpty() },
      modelPath = modelPath,
      prompt = prompt,
      systemPrompt = request.getString("systemPrompt")?.trim()?.takeIf { it.isNotEmpty() },
      history = parseHistory(request.getArray("history")),
      currentMessage = currentMessage,
      tools = parseToolDefinitions(request.getArray("tools")),
      backend = normalizeRequestedBackend(request.getString("backend")?.trim().orEmpty().ifEmpty { "cpu" }),
      visionBackend = normalizeOptionalBackend(request.getString("visionBackend")?.trim()),
      audioBackend = normalizeOptionalBackend(request.getString("audioBackend")?.trim()),
      maxTokens = sampling.maxTokens,
      contextWindowTokens = sampling.contextWindowTokens,
      topK = sampling.topK,
      topP = sampling.topP,
      temperature = sampling.temperature,
      enableConstrainedDecoding = readBoolean(request, "enableConstrainedDecoding", false),
      minDeviceMemoryGb = readInt(request, "minDeviceMemoryGb"),
    )
  }

  fun parseWarmupRequest(request: ReadableMap): WarmupRequest {
    val modelPath = request.getString("modelPath")?.trim().orEmpty()
    val sampling = parseSampling(request)

    require(modelPath.isNotEmpty()) { "modelPath is required." }
    validateSampling(sampling)

    return WarmupRequest(
      conversationKey = request.getString("conversationKey")?.trim()?.takeIf { it.isNotEmpty() },
      modelPath = modelPath,
      systemPrompt = request.getString("systemPrompt")?.trim()?.takeIf { it.isNotEmpty() },
      tools = parseToolDefinitions(request.getArray("tools")),
      backend = normalizeRequestedBackend(request.getString("backend")?.trim().orEmpty().ifEmpty { "cpu" }),
      visionBackend = normalizeOptionalBackend(request.getString("visionBackend")?.trim()),
      audioBackend = normalizeOptionalBackend(request.getString("audioBackend")?.trim()),
      maxTokens = sampling.maxTokens,
      contextWindowTokens = sampling.contextWindowTokens,
      topK = sampling.topK,
      topP = sampling.topP,
      temperature = sampling.temperature,
      enableConstrainedDecoding = readBoolean(request, "enableConstrainedDecoding", false),
      minDeviceMemoryGb = readInt(request, "minDeviceMemoryGb"),
    )
  }

  private fun parseHistory(historyArray: ReadableArray?): List<HistoryEntry> {
    if (historyArray == null) {
      return emptyList()
    }

    val entries = mutableListOf<HistoryEntry>()
    for (index in 0 until historyArray.size()) {
      entries.add(parseConversationMessage(historyArray.getMap(index)))
    }
    return entries
  }

  private fun parseConversationMessage(item: ReadableMap?): HistoryEntry {
    requireNotNull(item) { "conversation message is required." }
    val role = item.getString("role")?.trim().orEmpty()
    val content = item.getString("content")?.trim()?.takeIf { it.isNotEmpty() }
    val toolCalls = parseToolCalls(item.getArray("toolCalls"))
    val toolResponses = parseToolResponses(item.getArray("toolResponses"))

    require(role == "user" || role == "assistant" || role == "tool") {
      "Unsupported conversation message role: $role"
    }
    when (role) {
      "tool" -> require(toolResponses.isNotEmpty()) { "tool messages require toolResponses." }
      else -> require(content != null || toolCalls.isNotEmpty()) {
        "$role messages require content or toolCalls."
      }
    }

    return HistoryEntry(role, content, toolCalls, toolResponses)
  }

  private fun parseToolCalls(toolCallsArray: ReadableArray?): List<HistoryToolCallEntry> {
    if (toolCallsArray == null) {
      return emptyList()
    }
    val toolCalls = mutableListOf<HistoryToolCallEntry>()
    for (index in 0 until toolCallsArray.size()) {
      val item = toolCallsArray.getMap(index) ?: continue
      val name = item.getString("name")?.trim().orEmpty()
      if (name.isNotEmpty()) {
        toolCalls.add(HistoryToolCallEntry(name, readableMapToAnyMap(item.getMap("arguments"))))
      }
    }
    return toolCalls
  }

  private fun parseToolResponses(toolResponsesArray: ReadableArray?): List<HistoryToolResponseEntry> {
    if (toolResponsesArray == null) {
      return emptyList()
    }
    val toolResponses = mutableListOf<HistoryToolResponseEntry>()
    for (index in 0 until toolResponsesArray.size()) {
      val item = toolResponsesArray.getMap(index) ?: continue
      val name = item.getString("name")?.trim().orEmpty()
      if (name.isNotEmpty()) {
        val response = if (item.hasKey("response") && !item.isNull("response")) {
          readableValueToAny(item, "response")
        } else {
          null
        }
        toolResponses.add(HistoryToolResponseEntry(name, response))
      }
    }
    return toolResponses
  }

  private fun parseToolDefinitions(toolsArray: ReadableArray?): List<ToolDefinitionEntry> {
    if (toolsArray == null) {
      return emptyList()
    }
    val tools = mutableListOf<ToolDefinitionEntry>()
    for (index in 0 until toolsArray.size()) {
      val item = toolsArray.getMap(index) ?: continue
      val name = item.getString("name")?.trim().orEmpty()
      if (name.isNotEmpty()) {
        tools.add(
          ToolDefinitionEntry(
            name = name,
            description = item.getString("description")?.trim().orEmpty(),
            parameters = readableMapToAnyMap(item.getMap("parameters")),
          ),
        )
      }
    }
    return tools
  }

  private fun parseSampling(request: ReadableMap): SamplingFields {
    val maxTokens = readInt(request, "maxTokens") ?: DEFAULT_MAX_TOKENS
    return SamplingFields(
      maxTokens = maxTokens,
      contextWindowTokens = readInt(request, "contextWindowTokens") ?: maxTokens,
      topK = readInt(request, "topK"),
      topP = readFloat(request, "topP"),
      temperature = readFloat(request, "temperature"),
    )
  }

  private fun validateSampling(sampling: SamplingFields) {
    require(sampling.maxTokens > 0) { "maxTokens must be greater than 0." }
    require(sampling.contextWindowTokens > 0) { "contextWindowTokens must be greater than 0." }
    require(sampling.contextWindowTokens >= sampling.maxTokens) {
      "contextWindowTokens must be greater than or equal to maxTokens."
    }
    require(sampling.topK == null || sampling.topK > 0) { "topK must be greater than 0." }
    require(sampling.topP == null || (sampling.topP.isFinite() && sampling.topP > 0f && sampling.topP <= 1f)) {
      "topP must be greater than 0 and less than or equal to 1."
    }
    require(sampling.temperature == null || (sampling.temperature.isFinite() && sampling.temperature >= 0f)) {
      "temperature must be greater than or equal to 0."
    }
  }

  private data class SamplingFields(
    val maxTokens: Int,
    val contextWindowTokens: Int,
    val topK: Int?,
    val topP: Float?,
    val temperature: Float?,
  )
}

private fun normalizeRequestedBackend(backend: String): String {
  return normalizeLocalLlmAccelerator(backend)
}

private fun normalizeOptionalBackend(backend: String?): String? {
  return backend?.takeIf { it.isNotEmpty() }?.let(::normalizeRequestedBackend)
}

private fun readInt(request: ReadableMap, key: String): Int? {
  return if (request.hasKey(key) && !request.isNull(key)) {
    request.getDouble(key).toInt()
  } else {
    null
  }
}

private fun readFloat(request: ReadableMap, key: String): Float? {
  return if (request.hasKey(key) && !request.isNull(key)) {
    request.getDouble(key).toFloat()
  } else {
    null
  }
}

private fun readBoolean(request: ReadableMap, key: String, fallback: Boolean): Boolean {
  return if (request.hasKey(key) && !request.isNull(key)) {
    request.getBoolean(key)
  } else {
    fallback
  }
}
