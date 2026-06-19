package com.kavi.mobile.localllm

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine

internal const val LOCAL_LLM_STREAM_EVENT = "KaviLocalLlmStream"
internal const val BYTES_IN_GB = 1024.0 * 1024.0 * 1024.0
internal const val DEFAULT_MAX_TOKENS = 1024
internal const val MAX_CACHED_CONVERSATIONS_PER_ENGINE = 2
internal const val ACCELERATOR_FIRST_STREAM_CHUNK_TIMEOUT_MS = 10_000L
internal const val MEMORY_HARD_BLOCK_RATIO = 0.9
internal const val MEMORY_EPSILON_GB = 0.01

internal data class HistoryEntry(
  val role: String,
  val content: String? = null,
  val toolCalls: List<HistoryToolCallEntry> = emptyList(),
  val toolResponses: List<HistoryToolResponseEntry> = emptyList(),
)

internal data class HistoryToolCallEntry(
  val name: String,
  val arguments: Map<String, Any?>,
)

internal data class HistoryToolResponseEntry(
  val name: String,
  val response: Any?,
)

internal data class ToolDefinitionEntry(
  val name: String,
  val description: String,
  val parameters: Map<String, Any?>,
)

internal data class ToolCallResult(
  val id: String,
  val name: String,
  val arguments: Map<String, Any?>,
)

internal data class InferenceResult(
  val text: String,
  val toolCalls: List<ToolCallResult> = emptyList(),
  val backend: String,
)

internal interface EngineRequest {
  val modelPath: String
  val backend: String
  val visionBackend: String?
  val audioBackend: String?
  val maxTokens: Int
  val contextWindowTokens: Int
  val topK: Int?
  val topP: Float?
  val temperature: Float?
  val minDeviceMemoryGb: Int?
}

internal data class EngineKey(
  val modelPath: String,
  val backend: String,
  val visionBackend: String?,
  val audioBackend: String?,
)

internal data class EngineState(
  val key: EngineKey,
  val engine: Engine,
  val contextWindowTokens: Int,
  val activeRequestIds: MutableSet<String> = linkedSetOf(),
)

internal data class ConversationCacheKey(
  val engineKey: EngineKey,
  val conversationKey: String,
)

internal data class ConversationState(
  val conversation: Conversation,
  val configSignature: String,
  var transcriptSignature: String,
  var lastAccessedAt: Long,
  var activeRequestId: String? = null,
)

internal data class AcquiredConversation(
  val engineState: EngineState,
  val conversation: Conversation,
  val cacheKey: ConversationCacheKey?,
  val conversationState: ConversationState?,
  val closeOnRelease: Boolean,
  var closed: Boolean = false,
)

internal data class LocalRequest(
  val requestId: String,
  val conversationKey: String?,
  override val modelPath: String,
  val prompt: String?,
  val systemPrompt: String?,
  val history: List<HistoryEntry>,
  val currentMessage: HistoryEntry?,
  val tools: List<ToolDefinitionEntry>,
  override val backend: String,
  override val visionBackend: String?,
  override val audioBackend: String?,
  override val maxTokens: Int,
  override val contextWindowTokens: Int,
  override val topK: Int?,
  override val topP: Float?,
  override val temperature: Float?,
  val enableConstrainedDecoding: Boolean,
  override val minDeviceMemoryGb: Int?,
) : EngineRequest

internal data class WarmupRequest(
  val conversationKey: String?,
  override val modelPath: String,
  val systemPrompt: String?,
  val tools: List<ToolDefinitionEntry>,
  override val backend: String,
  override val visionBackend: String?,
  override val audioBackend: String?,
  override val maxTokens: Int,
  override val contextWindowTokens: Int,
  override val topK: Int?,
  override val topP: Float?,
  override val temperature: Float?,
  val enableConstrainedDecoding: Boolean,
  override val minDeviceMemoryGb: Int?,
) : EngineRequest

internal class RuntimeMetrics {
  var engineCreateCount = 0
  var engineReuseCount = 0
  var engineCloseCount = 0
  var conversationCreateCount = 0
  var conversationReuseCount = 0
  var conversationCloseCount = 0
  var backendFallbackCount = 0
  var activeRequestStartCount = 0
  var activeRequestEndCount = 0
  var activeRequestCancelCount = 0
  var constrainedDecodingEnabledCount = 0
  var speculativeDecodingEnabledCount = 0
  var capabilityCheckFailureCount = 0
  var lastConstrainedDecodingEnabled = false
  var lastSpeculativeDecodingEnabled = false
  var lastSpeculativeDecodingSupported: Boolean? = null

  fun recordAccelerationDecision(
    constrainedDecodingEnabled: Boolean,
    speculativeDecodingSupported: Boolean?,
    speculativeDecodingEnabled: Boolean,
    capabilityCheckFailed: Boolean,
  ) {
    lastConstrainedDecodingEnabled = constrainedDecodingEnabled
    lastSpeculativeDecodingEnabled = speculativeDecodingEnabled
    if (speculativeDecodingSupported != null) {
      lastSpeculativeDecodingSupported = speculativeDecodingSupported
    }
    if (constrainedDecodingEnabled) {
      constrainedDecodingEnabledCount += 1
    }
    if (speculativeDecodingEnabled) {
      speculativeDecodingEnabledCount += 1
    }
    if (capabilityCheckFailed) {
      capabilityCheckFailureCount += 1
    }
  }

  fun toWritableMap(): WritableMap {
    return Arguments.createMap().apply {
      putDouble("engineCreateCount", engineCreateCount.toDouble())
      putDouble("engineReuseCount", engineReuseCount.toDouble())
      putDouble("engineCloseCount", engineCloseCount.toDouble())
      putDouble("conversationCreateCount", conversationCreateCount.toDouble())
      putDouble("conversationReuseCount", conversationReuseCount.toDouble())
      putDouble("conversationCloseCount", conversationCloseCount.toDouble())
      putDouble("backendFallbackCount", backendFallbackCount.toDouble())
      putDouble("activeRequestStartCount", activeRequestStartCount.toDouble())
      putDouble("activeRequestEndCount", activeRequestEndCount.toDouble())
      putDouble("activeRequestCancelCount", activeRequestCancelCount.toDouble())
      putDouble("constrainedDecodingEnabledCount", constrainedDecodingEnabledCount.toDouble())
      putDouble("speculativeDecodingEnabledCount", speculativeDecodingEnabledCount.toDouble())
      putDouble("capabilityCheckFailureCount", capabilityCheckFailureCount.toDouble())
      putBoolean("lastConstrainedDecodingEnabled", lastConstrainedDecodingEnabled)
      putBoolean("lastSpeculativeDecodingEnabled", lastSpeculativeDecodingEnabled)
      lastSpeculativeDecodingSupported?.let {
        putBoolean("lastSpeculativeDecodingSupported", it)
      } ?: putNull("lastSpeculativeDecodingSupported")
    }
  }

  fun accelerationFeaturesToWritableMap(): WritableMap {
    return Arguments.createMap().apply {
      putBoolean("constrainedDecodingEnabled", lastConstrainedDecodingEnabled)
      putBoolean("speculativeDecodingEnabled", lastSpeculativeDecodingEnabled)
      lastSpeculativeDecodingSupported?.let {
        putBoolean("speculativeDecodingSupported", it)
      } ?: putNull("speculativeDecodingSupported")
      putDouble("constrainedDecodingEnabledCount", constrainedDecodingEnabledCount.toDouble())
      putDouble("speculativeDecodingEnabledCount", speculativeDecodingEnabledCount.toDouble())
      putDouble("capabilityCheckFailureCount", capabilityCheckFailureCount.toDouble())
    }
  }
}

internal fun buildToolCallWritableMap(toolCall: ToolCallResult): WritableMap {
  return Arguments.createMap().apply {
    putString("id", toolCall.id)
    putString("name", toolCall.name)
    putMap("arguments", Arguments.makeNativeMap(toolCall.arguments))
  }
}
