package com.kavi.mobile.localllm

import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "KaviLocalLlmForeground"

internal class LocalLlmForegroundCoordinator(private val context: Context) {
  private val activeRequestCount = AtomicInteger(0)

  fun onRequestStarted() {
    if (activeRequestCount.incrementAndGet() != 1) {
      return
    }
    try {
      LocalLlmForegroundService.start(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to start local LLM foreground service.", error)
    }
  }

  fun onRequestFinished() {
    val nextCount = activeRequestCount.updateAndGet { current -> (current - 1).coerceAtLeast(0) }
    if (nextCount != 0) {
      return
    }
    try {
      LocalLlmForegroundService.stop(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to stop local LLM foreground service.", error)
    }
  }

  fun close() {
    activeRequestCount.set(0)
    try {
      LocalLlmForegroundService.stop(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Failed to close local LLM foreground service.", error)
    }
  }
}
