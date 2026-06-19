package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.Capabilities

internal class LiteRtAccelerationPolicy(
  private val metrics: RuntimeMetrics,
) {
  private val cachedCapabilities = mutableMapOf<String, LiteRtModelCapabilities>()

  fun flagsForEngine(key: EngineKey): LiteRtFlagState {
    val modelCapabilities = getModelCapabilities(key.modelPath)
    val speculativeDecodingEnabled =
      modelCapabilities.supportsSpeculativeDecoding &&
        supportsSpeculativeDecodingOnAccelerator(key.backend)

    metrics.recordAccelerationDecision(
      constrainedDecodingEnabled = false,
      speculativeDecodingSupported = modelCapabilities.supportsSpeculativeDecoding,
      speculativeDecodingEnabled = speculativeDecodingEnabled,
      capabilityCheckFailed = modelCapabilities.checkFailed,
    )

    return LiteRtFlagState(speculativeDecodingEnabled = speculativeDecodingEnabled)
  }

  fun flagsForConversation(request: LocalRequest): LiteRtFlagState {
    metrics.recordAccelerationDecision(
      constrainedDecodingEnabled = request.enableConstrainedDecoding,
      speculativeDecodingSupported = null,
      speculativeDecodingEnabled = false,
      capabilityCheckFailed = false,
    )
    return LiteRtFlagState(constrainedDecodingEnabled = request.enableConstrainedDecoding)
  }

  private fun getModelCapabilities(modelPath: String): LiteRtModelCapabilities {
    return cachedCapabilities.getOrPut(modelPath) {
      try {
        Capabilities(modelPath).use { capabilities ->
          LiteRtModelCapabilities(
            supportsSpeculativeDecoding = capabilities.hasSpeculativeDecodingSupport(),
            checkFailed = false,
          )
        }
      } catch (_: Throwable) {
        LiteRtModelCapabilities(supportsSpeculativeDecoding = false, checkFailed = true)
      }
    }
  }
}

internal data class LiteRtModelCapabilities(
  val supportsSpeculativeDecoding: Boolean,
  val checkFailed: Boolean,
)
