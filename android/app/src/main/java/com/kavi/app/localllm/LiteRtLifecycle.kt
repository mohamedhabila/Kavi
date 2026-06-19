package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.Engine

internal fun Conversation.cancelLiteRtProcess() {
  try {
    javaClass.methods
      .firstOrNull { method -> method.name == "cancelProcess" && method.parameterCount == 0 }
      ?.invoke(this)
  } catch (_: Throwable) {
  }
}

internal fun closeConversationSilently(conversation: Conversation?) {
  try {
    conversation?.close()
  } catch (_: Throwable) {
  }
}

internal fun closeEngineSilently(engine: Engine?) {
  try {
    engine?.close()
  } catch (_: Throwable) {
  }
}
