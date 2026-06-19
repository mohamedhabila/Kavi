package com.kavi.mobile

import android.app.ActivityManager
import android.content.Context
import android.os.Process
import com.google.ai.edge.litertlm.Capabilities
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.Message
import org.json.JSONObject
import kotlin.system.measureTimeMillis

data class OnDeviceBenchmarkScenarioResult(
  val id: String,
  val status: String,
  val durationMs: Long?,
  val metrics: JSONObject,
  val error: String? = null,
)

data class OnDeviceBenchmarkConfig(
  val modelId: String,
  val modelPath: String,
  val reportPath: String,
  val backend: String,
  val runtime: String,
  val modelSupportsTools: Boolean,
  val conversationTurns: Int,
  val scenarioIds: Set<String>,
)

data class OnDeviceAccelerationState(
  val constrainedDecodingEnabled: Boolean,
  val speculativeDecodingSupported: Boolean,
  val speculativeDecodingEnabled: Boolean,
  val capabilityCheckFailed: Boolean,
)

fun passedOnDeviceScenario(
  id: String,
  durationMs: Long?,
  metrics: JSONObject,
): OnDeviceBenchmarkScenarioResult {
  return OnDeviceBenchmarkScenarioResult(
    id = id,
    status = "passed",
    durationMs = durationMs,
    metrics = metrics,
  )
}

fun skippedOnDeviceScenario(id: String, reason: String): OnDeviceBenchmarkScenarioResult {
  return OnDeviceBenchmarkScenarioResult(
    id = id,
    status = "skipped",
    durationMs = null,
    metrics = JSONObject(),
    error = reason,
  )
}

fun failedOnDeviceScenario(
  id: String,
  metrics: JSONObject,
  error: Throwable,
): OnDeviceBenchmarkScenarioResult {
  return OnDeviceBenchmarkScenarioResult(
    id = id,
    status = "failed",
    durationMs = null,
    metrics = metrics.copyJson()
      .put("nativeCrashed", false)
      .put("nativeErrorType", error::class.java.simpleName)
      .put("nativeErrorMessage", error.message ?: error.toString()),
    error = error.message ?: error.toString(),
  )
}

fun baseOnDeviceMetrics(
  config: OnDeviceBenchmarkConfig,
  memoryBeforeMb: Double?,
  memoryAfterMb: Double?,
  accelerationState: OnDeviceAccelerationState,
): JSONObject {
  return JSONObject()
    .put("engineInitMs", JSONObject.NULL)
    .put("ttftMs", JSONObject.NULL)
    .put("decodeTokensPerSecond", JSONObject.NULL)
    .put("outputTokens", JSONObject.NULL)
    .put("activeBackend", config.backend)
    .put("backendFallbackCount", 0)
    .put("backendFallbackReason", JSONObject.NULL)
    .put("nativeCrashed", false)
    .put("nativeErrorType", JSONObject.NULL)
    .put("nativeErrorMessage", JSONObject.NULL)
    .put("conversationCacheHits", 0)
    .put("conversationCacheMisses", 1)
    .put("memoryBeforeMb", memoryBeforeMb ?: JSONObject.NULL)
    .put("memoryAfterMb", memoryAfterMb ?: JSONObject.NULL)
    .put("contextWindowTokens", 4096)
    .put("inputTokens", JSONObject.NULL)
    .put("inputBudgetTokens", JSONObject.NULL)
    .put("contextPressureRatio", JSONObject.NULL)
    .put("contextCompactionState", "full")
    .put("constrainedDecodingEnabled", accelerationState.constrainedDecodingEnabled)
    .put("speculativeDecodingSupported", accelerationState.speculativeDecodingSupported)
    .put("speculativeDecodingEnabled", accelerationState.speculativeDecodingEnabled)
    .put("capabilityCheckFailed", accelerationState.capabilityCheckFailed)
}

fun resolveOnDeviceAccelerationState(
  config: OnDeviceBenchmarkConfig,
  constrainedDecodingEnabled: Boolean = false,
): OnDeviceAccelerationState {
  var capabilityCheckFailed = false
  val supportsSpeculativeDecoding = try {
    Capabilities(config.modelPath).use { capabilities ->
      capabilities.hasSpeculativeDecodingSupport()
    }
  } catch (_: Throwable) {
    capabilityCheckFailed = true
    false
  }

  return OnDeviceAccelerationState(
    constrainedDecodingEnabled = constrainedDecodingEnabled,
    speculativeDecodingSupported = supportsSpeculativeDecoding,
    speculativeDecodingEnabled = supportsSpeculativeDecoding &&
      config.backend.lowercase() == "gpu",
    capabilityCheckFailed = capabilityCheckFailed,
  )
}

fun isOnDeviceNpuAccelerator(accelerator: String): Boolean {
  val normalized = accelerator.lowercase()
  return normalized == "npu" || normalized == "tpu"
}

@OptIn(ExperimentalApi::class)
fun <T> withOnDeviceExperimentalFlags(
  accelerationState: OnDeviceAccelerationState,
  block: () -> T,
): T {
  synchronized(onDeviceExperimentalFlagLock) {
    val previousConstrainedDecoding = ExperimentalFlags.enableConversationConstrainedDecoding
    val previousSpeculativeDecoding = ExperimentalFlags.enableSpeculativeDecoding
    ExperimentalFlags.enableConversationConstrainedDecoding =
      accelerationState.constrainedDecodingEnabled
    ExperimentalFlags.enableSpeculativeDecoding = accelerationState.speculativeDecodingEnabled
    return try {
      block()
    } finally {
      ExperimentalFlags.enableConversationConstrainedDecoding = previousConstrainedDecoding
      ExperimentalFlags.enableSpeculativeDecoding = previousSpeculativeDecoding
    }
  }
}

fun readOnDeviceProcessMemoryMb(context: Context): Double? {
  return try {
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memoryInfo = activityManager.getProcessMemoryInfo(intArrayOf(Process.myPid())).firstOrNull()
    memoryInfo?.totalPss?.div(1024.0)
  } catch (_: Throwable) {
    null
  }
}

fun extractOnDeviceText(message: Message): String {
  return message.contents.contents
    .mapNotNull { content -> (content as? Content.Text)?.text }
    .joinToString(separator = "")
}

fun timedOnDeviceMillis(block: () -> Unit): Long {
  return measureTimeMillis(block)
}

suspend fun timedOnDeviceMillisSuspend(block: suspend () -> Unit): Long {
  val startedAt = System.currentTimeMillis()
  block()
  return System.currentTimeMillis() - startedAt
}

fun JSONObject.copyJson(): JSONObject {
  return JSONObject(this.toString())
}

fun closeOnDeviceConversation(conversation: Conversation?) {
  try {
    conversation?.close()
  } catch (_: Throwable) {
  }
}

fun closeOnDeviceEngine(engine: Engine?) {
  try {
    engine?.close()
  } catch (_: Throwable) {
  }
}

fun cancelOnDeviceConversation(conversation: Conversation) {
  try {
    conversation.javaClass.methods
      .firstOrNull { method -> method.name == "cancelProcess" && method.parameterCount == 0 }
      ?.invoke(conversation)
  } catch (_: Throwable) {
  }
}

private val onDeviceExperimentalFlagLock = Any()
