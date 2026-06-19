package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ToolCall
import com.google.ai.edge.litertlm.tool
import com.google.gson.Gson

internal class LiteRtMessageAdapter(
  private val gson: Gson,
) {
  fun resolveCurrentMessage(request: LocalRequest): Message {
    request.currentMessage?.let { return toLiteRtMessage(it) }
    return Message.user(requireNotNull(request.prompt) { "prompt or currentMessage is required." })
  }

  fun createConversationConfig(request: LocalRequest): ConversationConfig {
    val toolProviders = request.tools.map { definition -> tool(DynamicOpenApiTool(definition)) }
    val samplerConfig = createSamplerConfig(
      request.backend,
      request.topK,
      request.topP,
      request.temperature,
    )
    val commonConfig = ConversationConfig(
      systemInstruction = request.systemPrompt?.let { Contents.of(it) },
      initialMessages = request.history.map { entry -> toLiteRtMessage(entry) },
      tools = toolProviders,
      automaticToolCalling = toolProviders.isEmpty(),
    )

    return if (samplerConfig == null) {
      commonConfig
    } else {
      ConversationConfig(
        samplerConfig = samplerConfig,
        systemInstruction = commonConfig.systemInstruction,
        initialMessages = commonConfig.initialMessages,
        tools = commonConfig.tools,
        automaticToolCalling = commonConfig.automaticToolCalling,
      )
    }
  }

  fun buildInferenceResult(requestId: String, message: Message, backend: String): InferenceResult {
    return InferenceResult(
      text = extractTextContent(message),
      toolCalls = message.toolCalls.mapIndexed { index, toolCall ->
        ToolCallResult(
          id = buildSyntheticToolCallId(requestId, index),
          name = toolCall.name,
          arguments = toolCall.arguments,
        )
      },
      backend = backend,
    )
  }

  fun buildNewToolCallResults(
    requestId: String,
    toolCalls: List<ToolCall>,
    emittedToolCallOccurrences: MutableMap<String, Int>,
    emittedToolCallCount: Int,
  ): List<ToolCallResult> {
    val chunkOccurrences = linkedMapOf<String, Int>()
    val newToolCalls = mutableListOf<ToolCallResult>()

    for (toolCall in toolCalls) {
      val signature = "${toolCall.name}|${gson.toJson(toolCall.arguments)}"
      val chunkOccurrence = chunkOccurrences[signature] ?: 0
      chunkOccurrences[signature] = chunkOccurrence + 1
      val emittedOccurrence = emittedToolCallOccurrences[signature] ?: 0
      if (chunkOccurrence < emittedOccurrence) {
        continue
      }

      emittedToolCallOccurrences[signature] = emittedOccurrence + 1
      newToolCalls.add(
        ToolCallResult(
          id = buildSyntheticToolCallId(requestId, emittedToolCallCount + newToolCalls.size),
          name = toolCall.name,
          arguments = toolCall.arguments,
        ),
      )
    }

    return newToolCalls
  }

  fun buildConversationConfigSignature(request: LocalRequest): String {
    return gson.toJson(
      mapOf(
        "systemPrompt" to request.systemPrompt,
        "tools" to request.tools,
        "topK" to request.topK,
        "topP" to request.topP,
        "temperature" to request.temperature,
        "enableConstrainedDecoding" to request.enableConstrainedDecoding,
      ),
    )
  }

  fun buildTranscriptSignature(entries: List<HistoryEntry>): String {
    return gson.toJson(entries)
  }

  fun buildUpdatedTranscriptSignature(request: LocalRequest, result: InferenceResult): String {
    val transcript = request.history.toMutableList()
    transcript.add(buildCurrentHistoryEntry(request))
    buildAssistantHistoryEntry(result)?.let(transcript::add)
    return buildTranscriptSignature(transcript)
  }

  fun extractTextContent(message: Message): String {
    return message.contents.contents
      .mapNotNull { content -> (content as? Content.Text)?.text }
      .joinToString(separator = "")
  }

  private inner class DynamicOpenApiTool(
    private val definition: ToolDefinitionEntry,
  ) : OpenApiTool {
    override fun getToolDescriptionJsonString(): String {
      return gson.toJson(
        mapOf(
          "name" to definition.name,
          "description" to definition.description,
          "parameters" to definition.parameters,
        ),
      )
    }

    override fun execute(paramsJsonString: String): String {
      return "{\"error\":\"manual_tool_calling_only\"}"
    }
  }

  private fun toLiteRtMessage(entry: HistoryEntry): Message {
    return when (entry.role) {
      "assistant" -> {
        if (entry.toolCalls.isEmpty()) {
          Message.model(entry.content.orEmpty())
        } else {
          Message.model(
            buildContents(entry.content),
            entry.toolCalls.map { toolCall -> ToolCall(toolCall.name, toolCall.arguments) },
            emptyMap(),
          )
        }
      }
      "tool" -> Message.tool(
        Contents.of(
          entry.toolResponses.map { toolResponse ->
            Content.ToolResponse(toolResponse.name, toolResponse.response)
          },
        ),
      )
      else -> Message.user(entry.content.orEmpty())
    }
  }

  private fun buildContents(content: String?): Contents {
    val normalizedContent = content?.trim().orEmpty()
    return if (normalizedContent.isEmpty()) {
      Contents.of(emptyList<Content>())
    } else {
      Contents.of(normalizedContent)
    }
  }

  private fun createSamplerConfig(
    backend: String,
    topK: Int?,
    topP: Float?,
    temperature: Float?,
  ): SamplerConfig? {
    if (usesLiteRtNpuBackend(backend)) {
      return null
    }
    if (topK == null && topP == null && temperature == null) {
      return null
    }
    require(topK != null && topP != null && temperature != null) {
      "topK, topP, and temperature must all be provided together."
    }
    return SamplerConfig(topK = topK, topP = topP.toDouble(), temperature = temperature.toDouble())
  }

  private fun buildCurrentHistoryEntry(request: LocalRequest): HistoryEntry {
    request.currentMessage?.let { return it }
    return HistoryEntry(
      role = "user",
      content = requireNotNull(request.prompt) { "prompt or currentMessage is required." },
    )
  }

  private fun buildAssistantHistoryEntry(result: InferenceResult): HistoryEntry? {
    if (result.text.isEmpty() && result.toolCalls.isEmpty()) {
      return null
    }
    return HistoryEntry(
      role = "assistant",
      content = result.text.takeIf { it.isNotEmpty() },
      toolCalls = result.toolCalls.map { toolCall ->
        HistoryToolCallEntry(toolCall.name, toolCall.arguments)
      },
    )
  }

  private fun buildSyntheticToolCallId(requestId: String, index: Int): String {
    return "local_${requestId}_tool_$index"
  }
}
