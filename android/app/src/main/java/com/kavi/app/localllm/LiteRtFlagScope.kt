package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags

internal class LiteRtFlagScope {
  @OptIn(ExperimentalApi::class)
  fun <T> withScopedFlags(
    flags: LiteRtFlagState,
    block: () -> T,
  ): T {
    synchronized(lock) {
      val previousConstrainedDecoding = ExperimentalFlags.enableConversationConstrainedDecoding
      val previousSpeculativeDecoding = ExperimentalFlags.enableSpeculativeDecoding
      ExperimentalFlags.enableConversationConstrainedDecoding = flags.constrainedDecodingEnabled
      ExperimentalFlags.enableSpeculativeDecoding = flags.speculativeDecodingEnabled
      return try {
        block()
      } finally {
        ExperimentalFlags.enableConversationConstrainedDecoding = previousConstrainedDecoding
        ExperimentalFlags.enableSpeculativeDecoding = previousSpeculativeDecoding
      }
    }
  }

  companion object {
    private val lock = Any()
  }
}

internal data class LiteRtFlagState(
  val constrainedDecodingEnabled: Boolean = false,
  val speculativeDecodingEnabled: Boolean = false,
)
