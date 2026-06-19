package com.kavi.mobile.localllm

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

internal class LocalLlmEvents(
  private val reactContext: ReactApplicationContext,
) {
  fun emitToken(requestId: String, token: String, backend: String) {
    emit(requestId, "token", backend) {
      putString("content", token)
    }
  }

  fun emitToolCall(requestId: String, toolCall: ToolCallResult, backend: String) {
    emit(requestId, "tool_call", backend) {
      putMap("toolCall", buildToolCallWritableMap(toolCall))
    }
  }

  fun emitDone(requestId: String, backend: String? = null) {
    emit(requestId, "done", backend)
  }

  fun emitError(requestId: String, message: String) {
    emit(requestId, "error", null) {
      putString("error", message)
    }
  }

  private fun emit(
    requestId: String,
    type: String,
    backend: String?,
    mutate: com.facebook.react.bridge.WritableMap.() -> Unit = {},
  ) {
    val event = Arguments.createMap().apply {
      putString("requestId", requestId)
      putString("type", type)
      if (backend != null) {
        putString("backend", backend)
      }
      mutate()
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(LOCAL_LLM_STREAM_EVENT, event)
  }
}
