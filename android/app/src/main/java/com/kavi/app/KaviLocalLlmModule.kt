package com.kavi.app

import android.app.ActivityManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.LogSeverity
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ToolCall
import com.google.ai.edge.litertlm.tool
import com.google.gson.Gson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

class KaviLocalLlmModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val gpuFallbackErrorSnippets = listOf(
    "opencl",
    "libopencl",
    "vndksupport",
    "gpu sampler not available",
  )

  companion object {
    private const val STREAM_EVENT = "KaviLocalLlmStream"
    private const val BYTES_IN_GB = 1024.0 * 1024.0 * 1024.0
    private const val DEFAULT_MAX_TOKENS = 1024
    private const val MAX_CACHED_CONVERSATIONS_PER_ENGINE = 2
    private const val MEMORY_HARD_BLOCK_RATIO = 0.9
    private const val MEMORY_EPSILON_GB = 0.01

    @Volatile
    private var nativeLibraryPreloaded = false
  }

  private data class HistoryEntry(
    val role: String,
    val content: String? = null,
    val toolCalls: List<HistoryToolCallEntry> = emptyList(),
    val toolResponses: List<HistoryToolResponseEntry> = emptyList(),
  )

  private data class HistoryToolCallEntry(
    val name: String,
    val arguments: Map<String, Any?>,
  )

  private data class HistoryToolResponseEntry(
    val name: String,
    val response: Any?,
  )

  private data class ToolDefinitionEntry(
    val name: String,
    val description: String,
    val parameters: Map<String, Any?>,
  )

  private data class ToolCallResult(
    val id: String,
    val name: String,
    val arguments: Map<String, Any?>,
  )

  private data class InferenceResult(
    val text: String,
    val toolCalls: List<ToolCallResult> = emptyList(),
    val backend: String,
  )

  private interface EngineRequest {
    val modelPath: String
    val backend: String
    val maxTokens: Int
    val contextWindowTokens: Int
    val topK: Int?
    val topP: Float?
    val temperature: Float?
    val minDeviceMemoryGb: Int?
  }

  private data class EngineKey(
    val modelPath: String,
    val backend: String,
  )

  private data class CachedEngineEntry(
    val engine: Engine,
    val contextWindowTokens: Int,
  )

  private data class ConversationCacheKey(
    val engineKey: EngineKey,
    val conversationKey: String,
  )

  private data class CachedConversationEntry(
    val conversation: Conversation,
    val configSignature: String,
    var transcriptSignature: String,
    var lastAccessedAt: Long,
  )

  private data class AcquiredConversation(
    val conversation: Conversation,
    val cacheKey: ConversationCacheKey?,
    val cachedEntry: CachedConversationEntry?,
    val closeOnRelease: Boolean,
    var closed: Boolean = false,
  )

  private data class LocalRequest(
    val requestId: String,
    val conversationKey: String?,
    override val modelPath: String,
    val prompt: String?,
    val systemPrompt: String?,
    val history: List<HistoryEntry>,
    val currentMessage: HistoryEntry?,
    val tools: List<ToolDefinitionEntry>,
    override val backend: String,
    override val maxTokens: Int,
    override val contextWindowTokens: Int,
    override val topK: Int?,
    override val topP: Float?,
    override val temperature: Float?,
    val enableConstrainedDecoding: Boolean,
    override val minDeviceMemoryGb: Int?,
  ) : EngineRequest

  private data class WarmupRequest(
    val conversationKey: String?,
    override val modelPath: String,
    val systemPrompt: String?,
    val tools: List<ToolDefinitionEntry>,
    override val backend: String,
    override val maxTokens: Int,
    override val contextWindowTokens: Int,
    override val topK: Int?,
    override val topP: Float?,
    override val temperature: Float?,
    val enableConstrainedDecoding: Boolean,
    override val minDeviceMemoryGb: Int?,
  ) : EngineRequest

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val activeJobs = ConcurrentHashMap<String, Job>()
  private val engineCacheLock = Any()
  private val cachedEngines = ConcurrentHashMap<EngineKey, CachedEngineEntry>()
  private val cachedConversations = ConcurrentHashMap<ConversationCacheKey, CachedConversationEntry>()
  private val gson = Gson()

  override fun getName(): String = "KaviLocalLlm"

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by React Native event emitter contract.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by React Native event emitter contract.
  }

  @ReactMethod
  fun getAvailability(promise: Promise) {
    val deviceMemoryGb = getDeviceMemoryGb()
    val lowMemoryDevice = isLowMemoryDevice()
    val reason = if (lowMemoryDevice) {
      "This device reports Android low-RAM mode, which is not supported for on-device Gemma."
    } else {
      null
    }

    promise.resolve(Arguments.createMap().apply {
      putBoolean("available", !lowMemoryDevice)
      putBoolean("linked", true)
      putString("platform", "android")
      putString("runtime", "litert-lm")
      putBoolean("supportsStreaming", true)
      putBoolean("lowMemoryDevice", lowMemoryDevice)
      if (deviceMemoryGb != null) {
        putDouble("deviceMemoryGb", deviceMemoryGb)
      } else {
        putNull("deviceMemoryGb")
      }
      if (reason != null) {
        putString("reason", reason)
      } else {
        putNull("reason")
      }
    })
  }

  @ReactMethod
  fun warmup(request: ReadableMap, promise: Promise) {
    val parsed = try {
      parseWarmupRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    scope.launch {
      try {
        val backend = withCpuRetry(parsed) { warmupEngine(it) }
        promise.resolve(Arguments.createMap().apply {
          putString("backend", backend)
        })
      } catch (error: Throwable) {
        promise.reject("LOCAL_LLM_WARMUP_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun generate(request: ReadableMap, promise: Promise) {
    val parsed = try {
      parseRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    scope.launch {
      try {
        val result = withCpuRetry(parsed) { runInference(it) }
        promise.resolve(Arguments.createMap().apply {
          putString("text", result.text)
          putString("backend", result.backend)
          if (result.toolCalls.isNotEmpty()) {
            val toolCallsArray = Arguments.createArray()
            result.toolCalls.forEach { toolCall ->
              toolCallsArray.pushMap(buildToolCallWritableMap(toolCall))
            }
            putArray("toolCalls", toolCallsArray)
          }
        })
      } catch (error: Throwable) {
        promise.reject("LOCAL_LLM_GENERATE_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun startStreaming(request: ReadableMap, promise: Promise) {
    val parsed = try {
      parseRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    val job = scope.launch {
      try {
        val resolvedBackend = withCpuRetrySuspend(parsed) { runStreamingInference(it) }
        emitDone(parsed.requestId, resolvedBackend)
      } catch (_: CancellationException) {
        emitDone(parsed.requestId)
      } catch (error: Throwable) {
        emitError(parsed.requestId, error.message ?: "Local inference failed.")
      } finally {
        activeJobs.remove(parsed.requestId)
      }
    }

    activeJobs[parsed.requestId] = job
    promise.resolve(null)
  }

  @ReactMethod
  fun cancel(requestId: String, promise: Promise) {
    activeJobs.remove(requestId)?.cancel()
    promise.resolve(null)
  }

  override fun invalidate() {
    super.invalidate()
    activeJobs.values.forEach { it.cancel() }
    activeJobs.clear()
    closeCachedEngines()
    scope.cancel()
  }

  private fun parseRequest(request: ReadableMap): LocalRequest {
    val requestId = request.getString("requestId")?.trim().orEmpty()
    val conversationKey = request.getString("conversationKey")?.trim()?.takeIf { it.isNotEmpty() }
    val modelPath = request.getString("modelPath")?.trim().orEmpty()
    val prompt = request.getString("prompt")?.trim()?.takeIf { it.isNotEmpty() }
    val systemPrompt = request.getString("systemPrompt")?.trim()?.takeIf { it.isNotEmpty() }
    val backend = normalizeRequestedBackend(
      request.getString("backend")?.trim()?.lowercase().orEmpty().ifEmpty { "cpu" },
    )
    val maxTokens = if (request.hasKey("maxTokens") && !request.isNull("maxTokens")) {
      request.getDouble("maxTokens").toInt()
    } else {
      DEFAULT_MAX_TOKENS
    }
    val contextWindowTokens = if (request.hasKey("contextWindowTokens") && !request.isNull("contextWindowTokens")) {
      request.getDouble("contextWindowTokens").toInt()
    } else {
      maxTokens
    }
    val topK = if (request.hasKey("topK") && !request.isNull("topK")) {
      request.getDouble("topK").toInt()
    } else {
      null
    }
    val topP = if (request.hasKey("topP") && !request.isNull("topP")) {
      request.getDouble("topP").toFloat()
    } else {
      null
    }
    val temperature = if (request.hasKey("temperature") && !request.isNull("temperature")) {
      request.getDouble("temperature").toFloat()
    } else {
      null
    }
    val enableConstrainedDecoding = if (request.hasKey("enableConstrainedDecoding") && !request.isNull("enableConstrainedDecoding")) {
      request.getBoolean("enableConstrainedDecoding")
    } else {
      false
    }
    val minDeviceMemoryGb = if (request.hasKey("minDeviceMemoryGb") && !request.isNull("minDeviceMemoryGb")) {
      request.getDouble("minDeviceMemoryGb").toInt()
    } else {
      null
    }
    val history = parseHistory(request.getArray("history"))
    val currentMessage = if (request.hasKey("currentMessage") && !request.isNull("currentMessage")) {
      parseConversationMessage(request.getMap("currentMessage"))
    } else {
      null
    }
    val tools = parseToolDefinitions(request.getArray("tools"))

    require(requestId.isNotEmpty()) { "requestId is required." }
    require(modelPath.isNotEmpty()) { "modelPath is required." }
    require(prompt != null || currentMessage != null) { "prompt or currentMessage is required." }
    require(maxTokens > 0) { "maxTokens must be greater than 0." }
    require(contextWindowTokens > 0) { "contextWindowTokens must be greater than 0." }
    require(contextWindowTokens >= maxTokens) { "contextWindowTokens must be greater than or equal to maxTokens." }
    require(topK == null || topK > 0) { "topK must be greater than 0." }
    require(topP == null || (topP.isFinite() && topP > 0f && topP <= 1f)) { "topP must be greater than 0 and less than or equal to 1." }
    require(temperature == null || (temperature.isFinite() && temperature >= 0f)) { "temperature must be greater than or equal to 0." }

    return LocalRequest(
      requestId = requestId,
      conversationKey = conversationKey,
      modelPath = modelPath,
      prompt = prompt,
      systemPrompt = systemPrompt,
      history = history,
      currentMessage = currentMessage,
      tools = tools,
      backend = backend,
      maxTokens = maxTokens,
      contextWindowTokens = contextWindowTokens,
      topK = topK,
      topP = topP,
      temperature = temperature,
      enableConstrainedDecoding = enableConstrainedDecoding,
      minDeviceMemoryGb = minDeviceMemoryGb,
    )
  }

  private fun parseWarmupRequest(request: ReadableMap): WarmupRequest {
    val conversationKey = request.getString("conversationKey")?.trim()?.takeIf { it.isNotEmpty() }
    val modelPath = request.getString("modelPath")?.trim().orEmpty()
    val systemPrompt = request.getString("systemPrompt")?.trim()?.takeIf { it.isNotEmpty() }
    val backend = normalizeRequestedBackend(
      request.getString("backend")?.trim()?.lowercase().orEmpty().ifEmpty { "cpu" },
    )
    val maxTokens = if (request.hasKey("maxTokens") && !request.isNull("maxTokens")) {
      request.getDouble("maxTokens").toInt()
    } else {
      DEFAULT_MAX_TOKENS
    }
    val contextWindowTokens = if (request.hasKey("contextWindowTokens") && !request.isNull("contextWindowTokens")) {
      request.getDouble("contextWindowTokens").toInt()
    } else {
      maxTokens
    }
    val topK = if (request.hasKey("topK") && !request.isNull("topK")) {
      request.getDouble("topK").toInt()
    } else {
      null
    }
    val topP = if (request.hasKey("topP") && !request.isNull("topP")) {
      request.getDouble("topP").toFloat()
    } else {
      null
    }
    val temperature = if (request.hasKey("temperature") && !request.isNull("temperature")) {
      request.getDouble("temperature").toFloat()
    } else {
      null
    }
    val enableConstrainedDecoding = if (request.hasKey("enableConstrainedDecoding") && !request.isNull("enableConstrainedDecoding")) {
      request.getBoolean("enableConstrainedDecoding")
    } else {
      false
    }
    val minDeviceMemoryGb = if (request.hasKey("minDeviceMemoryGb") && !request.isNull("minDeviceMemoryGb")) {
      request.getDouble("minDeviceMemoryGb").toInt()
    } else {
      null
    }
    val tools = parseToolDefinitions(request.getArray("tools"))

    require(modelPath.isNotEmpty()) { "modelPath is required." }
    require(maxTokens > 0) { "maxTokens must be greater than 0." }
    require(contextWindowTokens > 0) { "contextWindowTokens must be greater than 0." }
    require(contextWindowTokens >= maxTokens) { "contextWindowTokens must be greater than or equal to maxTokens." }
    require(topK == null || topK > 0) { "topK must be greater than 0." }
    require(topP == null || (topP.isFinite() && topP > 0f && topP <= 1f)) { "topP must be greater than 0 and less than or equal to 1." }
    require(temperature == null || (temperature.isFinite() && temperature >= 0f)) { "temperature must be greater than or equal to 0." }

    return WarmupRequest(
      conversationKey = conversationKey,
      modelPath = modelPath,
      systemPrompt = systemPrompt,
      tools = tools,
      backend = backend,
      maxTokens = maxTokens,
      contextWindowTokens = contextWindowTokens,
      topK = topK,
      topP = topP,
      temperature = temperature,
      enableConstrainedDecoding = enableConstrainedDecoding,
      minDeviceMemoryGb = minDeviceMemoryGb,
    )
  }

  private fun parseHistory(historyArray: ReadableArray?): List<HistoryEntry> {
    if (historyArray == null) {
      return emptyList()
    }

    val entries = mutableListOf<HistoryEntry>()
    for (index in 0 until historyArray.size()) {
      val item = historyArray.getMap(index) ?: continue
      entries.add(parseConversationMessage(item))
    }
    return entries
  }

  private fun parseConversationMessage(item: ReadableMap?): HistoryEntry {
    requireNotNull(item) { "conversation message is required." }

    val role = item.getString("role")?.trim().orEmpty()
    val content = item.getString("content")?.trim()?.takeIf { it.isNotEmpty() }
    val toolCalls = parseToolCalls(item.getArray("toolCalls"))
    val toolResponses = parseToolResponses(item.getArray("toolResponses"))

    require(role.isNotEmpty()) { "conversation message role is required." }
    require(role == "user" || role == "assistant" || role == "tool") {
      "Unsupported conversation message role: $role"
    }

    when (role) {
      "tool" -> require(toolResponses.isNotEmpty()) { "tool messages require toolResponses." }
      else -> require(content != null || toolCalls.isNotEmpty()) {
        "$role messages require content or toolCalls."
      }
    }

    return HistoryEntry(
      role = role,
      content = content,
      toolCalls = toolCalls,
      toolResponses = toolResponses,
    )
  }

  private fun parseToolCalls(toolCallsArray: ReadableArray?): List<HistoryToolCallEntry> {
    if (toolCallsArray == null) {
      return emptyList()
    }

    val toolCalls = mutableListOf<HistoryToolCallEntry>()
    for (index in 0 until toolCallsArray.size()) {
      val item = toolCallsArray.getMap(index) ?: continue
      val name = item.getString("name")?.trim().orEmpty()
      if (name.isEmpty()) {
        continue
      }

      val arguments = if (item.hasKey("arguments") && !item.isNull("arguments")) {
        readableMapToAnyMap(item.getMap("arguments"))
      } else {
        emptyMap()
      }

      toolCalls.add(
        HistoryToolCallEntry(
          name = name,
          arguments = arguments,
        ),
      )
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
      if (name.isEmpty()) {
        continue
      }

      val response = if (item.hasKey("response") && !item.isNull("response")) {
        readableValueToAny(item, "response")
      } else {
        null
      }

      toolResponses.add(
        HistoryToolResponseEntry(
          name = name,
          response = response,
        ),
      )
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
      if (name.isEmpty()) {
        continue
      }

      val description = item.getString("description")?.trim().orEmpty()
      val parameters = if (item.hasKey("parameters") && !item.isNull("parameters")) {
        readableMapToAnyMap(item.getMap("parameters"))
      } else {
        emptyMap()
      }

      tools.add(
        ToolDefinitionEntry(
          name = name,
          description = description,
          parameters = parameters,
        ),
      )
    }

    return tools
  }

  private fun readableMapToAnyMap(readableMap: ReadableMap?): Map<String, Any?> {
    if (readableMap == null) {
      return emptyMap()
    }

    val result = linkedMapOf<String, Any?>()
    val iterator = readableMap.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      result[key] = readableValueToAny(readableMap, key)
    }
    return result
  }

  private fun readableArrayToAnyList(readableArray: ReadableArray?): List<Any?> {
    if (readableArray == null) {
      return emptyList()
    }

    val result = mutableListOf<Any?>()
    for (index in 0 until readableArray.size()) {
      result.add(
        when (readableArray.getType(index)) {
          ReadableType.Null -> null
          ReadableType.Boolean -> readableArray.getBoolean(index)
          ReadableType.Number -> {
            val value = readableArray.getDouble(index)
            if (value % 1.0 == 0.0 && value in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) {
              value.toInt()
            } else {
              value
            }
          }
          ReadableType.String -> readableArray.getString(index)
          ReadableType.Map -> readableMapToAnyMap(readableArray.getMap(index))
          ReadableType.Array -> readableArrayToAnyList(readableArray.getArray(index))
        },
      )
    }
    return result
  }

  private fun readableValueToAny(readableMap: ReadableMap, key: String): Any? {
    return when (readableMap.getType(key)) {
      ReadableType.Null -> null
      ReadableType.Boolean -> readableMap.getBoolean(key)
      ReadableType.Number -> {
        val value = readableMap.getDouble(key)
        if (value % 1.0 == 0.0 && value in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) {
          value.toInt()
        } else {
          value
        }
      }
      ReadableType.String -> readableMap.getString(key)
      ReadableType.Map -> readableMapToAnyMap(readableMap.getMap(key))
      ReadableType.Array -> readableArrayToAnyList(readableMap.getArray(key))
    }
  }

  private fun runInference(request: LocalRequest): InferenceResult {
    val currentMessage = resolveCurrentMessage(request)

    return withEngine(request) { engine, resolvedBackend, engineKey ->
      val acquiredConversation = acquireConversationOrResetEngine(engine, engineKey, request)

      try {
        val result = buildInferenceResult(
          request.requestId,
          acquiredConversation.conversation.sendMessage(currentMessage),
          resolvedBackend,
        )
        commitConversation(acquiredConversation, buildUpdatedTranscriptSignature(request, result))
        result
      } catch (error: Throwable) {
        invalidateConversation(acquiredConversation)
        resetEngineAfterFailure(engineKey, error)
        throw error
      } finally {
        releaseConversation(acquiredConversation)
      }
    }
  }

  private suspend fun runStreamingInference(request: LocalRequest): String {
    val currentMessage = resolveCurrentMessage(request)

    return withEngine(request) { engine, resolvedBackend, engineKey ->
      val acquiredConversation = acquireConversationOrResetEngine(engine, engineKey, request)
      val streamedText = StringBuilder()
      val streamedToolCalls = mutableListOf<ToolCallResult>()

      try {
        val emittedToolCallOccurrences = linkedMapOf<String, Int>()
        var emittedToolCallCount = 0

        acquiredConversation.conversation.sendMessageAsync(currentMessage).collect { chunk ->
          val textChunk = extractTextContent(chunk)
          if (textChunk.isNotEmpty()) {
            streamedText.append(textChunk)
            emitToken(request.requestId, textChunk, resolvedBackend)
          }

          val newlyEmittedToolCalls = buildNewToolCallResults(
            request.requestId,
            chunk.toolCalls,
            emittedToolCallOccurrences,
            emittedToolCallCount,
          )

          newlyEmittedToolCalls.forEach { toolCall ->
            streamedToolCalls.add(toolCall)
            emitToolCall(request.requestId, toolCall, resolvedBackend)
          }
          emittedToolCallCount += newlyEmittedToolCalls.size
        }

        commitConversation(
          acquiredConversation,
          buildUpdatedTranscriptSignature(
            request,
            InferenceResult(
              text = streamedText.toString(),
              toolCalls = streamedToolCalls.toList(),
              backend = resolvedBackend,
            ),
          ),
        )
      } catch (error: Throwable) {
        invalidateConversation(acquiredConversation)
        resetEngineAfterFailure(engineKey, error)
        throw error
      } finally {
        releaseConversation(acquiredConversation)
      }

      resolvedBackend
    }
  }

  private fun warmupEngine(request: WarmupRequest): String {
    return withEngine(request) { engine, resolvedBackend, engineKey ->
      val conversationKey = request.conversationKey?.takeIf { it.isNotBlank() }
      if (conversationKey != null) {
        val acquiredConversation = acquireConversationOrResetEngine(
          engine,
          engineKey,
          LocalRequest(
            requestId = "warmup:$conversationKey",
            conversationKey = conversationKey,
            modelPath = request.modelPath,
            prompt = null,
            systemPrompt = request.systemPrompt,
            history = emptyList(),
            currentMessage = null,
            tools = request.tools,
            backend = resolvedBackend,
            maxTokens = request.maxTokens,
            contextWindowTokens = request.contextWindowTokens,
            topK = request.topK,
            topP = request.topP,
            temperature = request.temperature,
            enableConstrainedDecoding = request.enableConstrainedDecoding,
            minDeviceMemoryGb = request.minDeviceMemoryGb,
          ),
        )
        releaseConversation(acquiredConversation)
      }

      resolvedBackend
    }
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

  private fun resolveCurrentMessage(request: LocalRequest): Message {
    request.currentMessage?.let { return toLiteRtMessage(it) }
    return Message.user(requireNotNull(request.prompt) { "prompt or currentMessage is required." })
  }

  private fun buildContents(content: String?): Contents {
    val normalizedContent = content?.trim().orEmpty()
    return if (normalizedContent.isEmpty()) {
      Contents.of(emptyList<Content>())
    } else {
      Contents.of(normalizedContent)
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

  private fun buildInferenceResult(requestId: String, message: Message, backend: String): InferenceResult {
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

  private fun buildConversationConfigSignature(request: LocalRequest): String {
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

  private fun buildTranscriptSignature(entries: List<HistoryEntry>): String {
    return gson.toJson(entries)
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
        HistoryToolCallEntry(
          name = toolCall.name,
          arguments = toolCall.arguments,
        )
      },
    )
  }

  private fun buildUpdatedTranscriptSignature(request: LocalRequest, result: InferenceResult): String {
    val transcript = request.history.toMutableList()
    transcript.add(buildCurrentHistoryEntry(request))
    buildAssistantHistoryEntry(result)?.let(transcript::add)
    return buildTranscriptSignature(transcript)
  }

  private fun extractTextContent(message: Message): String {
    return message.contents.contents
      .mapNotNull { content -> (content as? Content.Text)?.text }
      .joinToString(separator = "")
  }

  private fun buildToolCallSignature(toolCall: ToolCall): String {
    return "${toolCall.name}|${gson.toJson(toolCall.arguments)}"
  }

  private fun buildSyntheticToolCallId(requestId: String, index: Int): String {
    return "local_${requestId}_tool_$index"
  }

  private fun buildNewToolCallResults(
    requestId: String,
    toolCalls: List<ToolCall>,
    emittedToolCallOccurrences: MutableMap<String, Int>,
    emittedToolCallCount: Int,
  ): List<ToolCallResult> {
    if (toolCalls.isEmpty()) {
      return emptyList()
    }

    val chunkOccurrences = linkedMapOf<String, Int>()
    val newToolCalls = mutableListOf<ToolCallResult>()

    for (toolCall in toolCalls) {
      val signature = buildToolCallSignature(toolCall)
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

  private fun buildToolCallWritableMap(toolCall: ToolCallResult) = Arguments.createMap().apply {
    putString("id", toolCall.id)
    putString("name", toolCall.name)
    putMap("arguments", Arguments.makeNativeMap(toolCall.arguments))
  }

  private fun acquireConversation(
    engine: Engine,
    engineKey: EngineKey,
    request: LocalRequest,
  ): AcquiredConversation {
    val conversationKey = request.conversationKey?.takeIf { it.isNotBlank() }
    if (conversationKey == null) {
      return AcquiredConversation(
        conversation = createConversation(engine, request),
        cacheKey = null,
        cachedEntry = null,
        closeOnRelease = true,
      )
    }

    val cacheKey = ConversationCacheKey(engineKey = engineKey, conversationKey = conversationKey)
    val expectedTranscriptSignature = buildTranscriptSignature(request.history)
    val configSignature = buildConversationConfigSignature(request)
    val existingEntry = cachedConversations[cacheKey]

    if (
      existingEntry != null
      && existingEntry.configSignature == configSignature
      && existingEntry.transcriptSignature == expectedTranscriptSignature
    ) {
      existingEntry.lastAccessedAt = System.currentTimeMillis()
      return AcquiredConversation(
        conversation = existingEntry.conversation,
        cacheKey = cacheKey,
        cachedEntry = existingEntry,
        closeOnRelease = false,
      )
    }

    if (existingEntry != null) {
      cachedConversations.remove(cacheKey, existingEntry)
      closeConversationSilently(existingEntry.conversation)
    }

    val newEntry = CachedConversationEntry(
      conversation = createConversation(engine, request),
      configSignature = configSignature,
      transcriptSignature = expectedTranscriptSignature,
      lastAccessedAt = System.currentTimeMillis(),
    )
    cachedConversations[cacheKey] = newEntry
    trimCachedConversationsForEngine(engineKey, cacheKey)

    return AcquiredConversation(
      conversation = newEntry.conversation,
      cacheKey = cacheKey,
      cachedEntry = newEntry,
      closeOnRelease = false,
    )
  }

  private fun acquireConversationOrResetEngine(
    engine: Engine,
    engineKey: EngineKey,
    request: LocalRequest,
  ): AcquiredConversation {
    return try {
      acquireConversation(engine, engineKey, request)
    } catch (error: Throwable) {
      resetEngineAfterFailure(engineKey, error)
      throw error
    }
  }

  private fun commitConversation(acquiredConversation: AcquiredConversation, transcriptSignature: String) {
    acquiredConversation.cachedEntry?.apply {
      this.transcriptSignature = transcriptSignature
      this.lastAccessedAt = System.currentTimeMillis()
    }
  }

  private fun trimCachedConversationsForEngine(
    engineKey: EngineKey,
    keepKey: ConversationCacheKey,
  ) {
    val cachedEntries = cachedConversations.entries
      .filter { (cacheKey, _) -> cacheKey.engineKey == engineKey && cacheKey != keepKey }
      .sortedBy { (_, entry) -> entry.lastAccessedAt }
    val overflow = (cachedEntries.size + 1) - MAX_CACHED_CONVERSATIONS_PER_ENGINE
    if (overflow <= 0) {
      return
    }

    cachedEntries.take(overflow).forEach { (cacheKey, entry) ->
      if (cachedConversations.remove(cacheKey, entry)) {
        closeConversationSilently(entry.conversation)
      }
    }
  }

  private fun releaseConversation(acquiredConversation: AcquiredConversation) {
    if (!acquiredConversation.closeOnRelease) {
      return
    }
    closeAcquiredConversation(acquiredConversation)
  }

  private fun invalidateConversation(acquiredConversation: AcquiredConversation) {
    val cacheKey = acquiredConversation.cacheKey
    if (cacheKey != null) {
      val removed = cachedConversations.remove(cacheKey)
      if (removed != null) {
        closeConversationSilently(removed.conversation)
      } else {
        closeAcquiredConversation(acquiredConversation)
      }
      acquiredConversation.closed = true
      return
    }

    closeAcquiredConversation(acquiredConversation)
  }

  private fun closeAcquiredConversation(acquiredConversation: AcquiredConversation) {
    if (acquiredConversation.closed) {
      return
    }
    acquiredConversation.closed = true
    closeConversationSilently(acquiredConversation.conversation)
  }

  private fun closeConversationSilently(conversation: Conversation) {
    try {
      conversation.close()
    } catch (_: Throwable) {
    }
  }

  @OptIn(ExperimentalApi::class)
  private inline fun <T> withConversationConstrainedDecoding(
    enabled: Boolean,
    block: () -> T,
  ): T {
    val previousValue = ExperimentalFlags.enableConversationConstrainedDecoding
    ExperimentalFlags.enableConversationConstrainedDecoding = enabled
    return try {
      block()
    } finally {
      ExperimentalFlags.enableConversationConstrainedDecoding = previousValue
    }
  }

  private fun createConversation(engine: Engine, request: LocalRequest): Conversation {
    return withConversationConstrainedDecoding(request.enableConstrainedDecoding) {
      engine.createConversation(createConversationConfig(request))
    }
  }

  private inline fun <T> withCpuRetry(request: WarmupRequest, operation: (WarmupRequest) -> T): T {
    return try {
      operation(request)
    } catch (error: Throwable) {
      if (!shouldFallbackToCpu(request.backend, error)) {
        throw error
      }
      operation(request.copy(backend = "cpu"))
    }
  }

  private inline fun <T> withCpuRetry(request: LocalRequest, operation: (LocalRequest) -> T): T {
    return try {
      operation(request)
    } catch (error: Throwable) {
      if (!shouldFallbackToCpu(request.backend, error)) {
        throw error
      }
      operation(request.copy(backend = "cpu"))
    }
  }

  private suspend inline fun <T> withCpuRetrySuspend(
    request: LocalRequest,
    crossinline operation: suspend (LocalRequest) -> T,
  ): T {
    return try {
      operation(request)
    } catch (error: Throwable) {
      if (!shouldFallbackToCpu(request.backend, error)) {
        throw error
      }
      operation(request.copy(backend = "cpu"))
    }
  }

  private fun createConversationConfig(request: LocalRequest): ConversationConfig {
    val toolProviders = request.tools.map { definition -> tool(DynamicOpenApiTool(definition)) }
    val samplerConfig = createSamplerConfig(request.topK, request.topP, request.temperature)

    return if (samplerConfig != null) {
      ConversationConfig(
        samplerConfig = samplerConfig,
        systemInstruction = request.systemPrompt?.let { Contents.of(it) },
        initialMessages = request.history.map { entry -> toLiteRtMessage(entry) },
        tools = toolProviders,
        automaticToolCalling = toolProviders.isEmpty(),
      )
    } else {
      ConversationConfig(
        systemInstruction = request.systemPrompt?.let { Contents.of(it) },
        initialMessages = request.history.map { entry -> toLiteRtMessage(entry) },
        tools = toolProviders,
        automaticToolCalling = toolProviders.isEmpty(),
      )
    }
  }

  private fun createSamplerConfig(topK: Int?, topP: Float?, temperature: Float?): SamplerConfig? {
    if (topK == null && topP == null && temperature == null) {
      return null
    }

    require(topK != null && topP != null && temperature != null) {
      "topK, topP, and temperature must all be provided together."
    }

    return SamplerConfig(
      topK = topK,
      topP = topP.toDouble(),
      temperature = temperature.toDouble(),
    )
  }

  private fun buildEngineKey(request: EngineRequest): EngineKey {
    return EngineKey(
      modelPath = request.modelPath,
      backend = normalizeRequestedBackend(request.backend),
    )
  }

  private fun normalizeRequestedBackend(backend: String): String {
    val normalizedBackend = backend.lowercase()
    if (normalizedBackend != "gpu") {
      return normalizedBackend
    }

    if (isProbablyEmulator()) {
      return "cpu"
    }

    return normalizedBackend
  }

  private fun isProbablyEmulator(): Boolean {
    val fingerprint = Build.FINGERPRINT.lowercase()
    val model = Build.MODEL.lowercase()
    val manufacturer = Build.MANUFACTURER.lowercase()
    val brand = Build.BRAND.lowercase()
    val device = Build.DEVICE.lowercase()
    val product = Build.PRODUCT.lowercase()
    val hardware = Build.HARDWARE.lowercase()

    return fingerprint.startsWith("generic") ||
      fingerprint.contains("emulator") ||
      fingerprint.contains("sdk_gphone") ||
      model.contains("emulator") ||
      model.contains("android sdk built for x86") ||
      model.contains("sdk_gphone") ||
      manufacturer.contains("genymotion") ||
      (brand.startsWith("generic") && device.startsWith("generic")) ||
      product.contains("sdk_gphone") ||
      product.contains("emulator") ||
      product.contains("simulator") ||
      hardware.contains("goldfish") ||
      hardware.contains("ranchu")
  }

  private fun ensureLiteRtNativeLibraryLoaded() {
    if (nativeLibraryPreloaded) {
      return
    }

    synchronized(KaviLocalLlmModule::class.java) {
      if (nativeLibraryPreloaded) {
        return
      }

      try {
        System.loadLibrary("litertlm_jni")
        nativeLibraryPreloaded = true
      } catch (_: UnsatisfiedLinkError) {
      }
    }
  }

  private fun getOrCreateEngine(request: EngineRequest, key: EngineKey = buildEngineKey(request)): Engine {
    validateRequestEnvironment(request)
    synchronized(engineCacheLock) {
      val existingEntry = cachedEngines[key]
      if (existingEntry != null && existingEntry.contextWindowTokens >= request.contextWindowTokens) {
        return existingEntry.engine
      }

      if (existingEntry != null) {
        cachedEngines.remove(key, existingEntry)
        closeCachedConversationsForEngine(key)
        closeEngineSilently(existingEntry.engine)
      }

      val engine = createInitializedEngine(key, request.contextWindowTokens)
      cachedEngines[key] = CachedEngineEntry(
        engine = engine,
        contextWindowTokens = request.contextWindowTokens,
      )
      return engine
    }
  }

  private inline fun <T> withEngine(request: EngineRequest, operation: (Engine, String, EngineKey) -> T): T {
    val key = buildEngineKey(request)

    return try {
      operation(getOrCreateEngine(request, key), key.backend, key)
    } catch (error: Throwable) {
      if (!shouldFallbackToCpu(key.backend, error)) {
        throw error
      }

      val fallbackKey = key.copy(backend = "cpu")
      val fallbackEngine = try {
        replaceEngineWithCpuFallback(key, request.contextWindowTokens)
      } catch (fallbackInitializationError: Throwable) {
        fallbackInitializationError.addSuppressed(error)
        throw fallbackInitializationError
      }

      try {
        operation(fallbackEngine, fallbackKey.backend, fallbackKey)
      } catch (fallbackError: Throwable) {
        fallbackError.addSuppressed(error)
        throw fallbackError
      }
    }
  }

  private fun replaceEngineWithCpuFallback(key: EngineKey, contextWindowTokens: Int): Engine {
    closeCachedEngine(key)
    val fallbackKey = key.copy(backend = "cpu")
    synchronized(engineCacheLock) {
      val existingEntry = cachedEngines[fallbackKey]
      if (existingEntry != null && existingEntry.contextWindowTokens >= contextWindowTokens) {
        return existingEntry.engine
      }

      if (existingEntry != null) {
        cachedEngines.remove(fallbackKey, existingEntry)
        closeCachedConversationsForEngine(fallbackKey)
        closeEngineSilently(existingEntry.engine)
      }

      val fallbackEngine = createInitializedEngine(fallbackKey, contextWindowTokens)
      cachedEngines[fallbackKey] = CachedEngineEntry(
        engine = fallbackEngine,
        contextWindowTokens = contextWindowTokens,
      )
      return fallbackEngine
    }
  }

  private fun closeCachedEngine(key: EngineKey) {
    closeCachedConversationsForEngine(key)
    val engineEntry = synchronized(engineCacheLock) {
      cachedEngines.remove(key)
    }
    closeEngineSilently(engineEntry?.engine)
  }

  private fun resetEngineAfterFailure(engineKey: EngineKey, error: Throwable) {
    if (error is CancellationException) {
      return
    }

    closeCachedEngine(engineKey)
  }

  private fun closeCachedConversationsForEngine(engineKey: EngineKey) {
    val matchingKeys = cachedConversations.keys.filter { cacheKey -> cacheKey.engineKey == engineKey }
    matchingKeys.forEach { cacheKey ->
      val entry = cachedConversations.remove(cacheKey) ?: return@forEach
      closeConversationSilently(entry.conversation)
    }
  }

  private fun closeEngineSilently(engine: Engine?) {
    if (engine == null) {
      return
    }

    try {
      engine.close()
    } catch (_: Throwable) {
    }
  }

  private fun shouldFallbackToCpu(requestedBackend: String, error: Throwable): Boolean {
    if (requestedBackend.lowercase() != "gpu") {
      return false
    }

    return containsGpuFallbackError(error)
  }

  private fun containsGpuFallbackError(error: Throwable?): Boolean {
    if (error == null) {
      return false
    }

    val message = error.message.orEmpty()
    if (gpuFallbackErrorSnippets.any { snippet -> message.contains(snippet, ignoreCase = true) }) {
      return true
    }

    if (containsGpuFallbackError(error.cause)) {
      return true
    }

    return error.suppressed.any { suppressed -> containsGpuFallbackError(suppressed) }
  }

  private fun createInitializedEngine(key: EngineKey, contextWindowTokens: Int): Engine {
    require(contextWindowTokens > 0) { "contextWindowTokens must be greater than 0." }
    ensureLiteRtNativeLibraryLoaded()
    Engine.setNativeMinLogSeverity(LogSeverity.ERROR)
    val engine = Engine(
      EngineConfig(
        modelPath = key.modelPath,
        backend = resolveBackend(key.backend),
        maxNumTokens = contextWindowTokens,
        cacheDir = resolveCacheDir(key.modelPath),
      ),
    )

    try {
      engine.initialize()
      return engine
    } catch (error: Throwable) {
      try {
        engine.close()
      } catch (_: Throwable) {
      }
      throw error
    }
  }

  private fun closeCachedEngines() {
    val conversations = cachedConversations.values.toList()
    cachedConversations.clear()
    conversations.forEach { entry ->
      closeConversationSilently(entry.conversation)
    }

    val engines = synchronized(engineCacheLock) {
      val values = cachedEngines.values.toList()
      cachedEngines.clear()
      values
    }
    engines.forEach { entry ->
      closeEngineSilently(entry.engine)
    }
  }

  private fun resolveBackend(name: String): Backend {
    return when (name.lowercase()) {
      "gpu" -> Backend.GPU()
      else -> Backend.CPU()
    }
  }

  private fun resolveCacheDir(modelPath: String): String? {
    return if (modelPath.startsWith("/data/local/tmp")) {
      reactContext.getExternalFilesDir(null)?.absolutePath
    } else {
      null
    }
  }

  private fun validateRequestEnvironment(request: EngineRequest) {
    if (isLowMemoryDevice()) {
      throw IllegalStateException("This device reports Android low-RAM mode, which is not supported for on-device Gemma.")
    }

    val minDeviceMemoryGb = request.minDeviceMemoryGb ?: return
    val deviceMemoryGb = getDeviceMemoryGb() ?: return
    val hardBlockFloorGb = minDeviceMemoryGb.toDouble() * MEMORY_HARD_BLOCK_RATIO
    if (deviceMemoryGb + MEMORY_EPSILON_GB < hardBlockFloorGb) {
      throw IllegalStateException(
        "This device reports about ${formatMemoryGb(deviceMemoryGb)} GB of memory, but the selected on-device model is recommended for devices with at least $minDeviceMemoryGb GB and is blocked here to avoid startup failures.",
      )
    }
  }

  private fun getActivityManager(): ActivityManager? {
    return reactContext.getSystemService(ActivityManager::class.java)
  }

  private fun getDeviceMemoryGb(): Double? {
    val activityManager = getActivityManager() ?: return null
    val memoryInfo = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(memoryInfo)
    val totalBytes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      memoryInfo.advertisedMem.toDouble()
    } else {
      memoryInfo.totalMem.toDouble()
    }
    return totalBytes / BYTES_IN_GB
  }

  private fun isLowMemoryDevice(): Boolean {
    return getActivityManager()?.isLowRamDevice ?: false
  }

  private fun formatMemoryGb(value: Double): String {
    val rounded = kotlin.math.round(value * 10.0) / 10.0
    return if (rounded % 1.0 == 0.0) {
      rounded.toInt().toString()
    } else {
      rounded.toString()
    }
  }

  private fun emitToken(requestId: String, content: String, backend: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(STREAM_EVENT, Arguments.createMap().apply {
        putString("requestId", requestId)
        putString("type", "token")
        putString("content", content)
        putString("backend", backend)
      })
  }

  private fun emitToolCall(requestId: String, toolCall: ToolCallResult, backend: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(STREAM_EVENT, Arguments.createMap().apply {
        putString("requestId", requestId)
        putString("type", "tool_call")
        putString("backend", backend)
        putMap("toolCall", buildToolCallWritableMap(toolCall))
      })
  }

  private fun emitDone(requestId: String, backend: String? = null) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(STREAM_EVENT, Arguments.createMap().apply {
        putString("requestId", requestId)
        putString("type", "done")
        if (backend != null) {
          putString("backend", backend)
        }
      })
  }

  private fun emitError(requestId: String, message: String, backend: String? = null) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(STREAM_EVENT, Arguments.createMap().apply {
        putString("requestId", requestId)
        putString("type", "error")
        putString("error", message)
        if (backend != null) {
          putString("backend", backend)
        }
      })
  }
}