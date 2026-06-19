package com.kavi.mobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.kavi.mobile.localllm.LocalLlmRequestParser
import com.kavi.mobile.localllm.LocalLlmRuntime

class KaviLocalLlmModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val requestParser = LocalLlmRequestParser()
  private val runtime = LocalLlmRuntime(reactContext)

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
    promise.resolve(runtime.getAvailability())
  }

  @ReactMethod
  fun warmup(request: ReadableMap, promise: Promise) {
    val parsed = try {
      requestParser.parseWarmupRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    runtime.warmup(parsed, promise)
  }

  @ReactMethod
  fun generate(request: ReadableMap, promise: Promise) {
    val parsed = try {
      requestParser.parseRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    runtime.generate(parsed, promise)
  }

  @ReactMethod
  fun startStreaming(request: ReadableMap, promise: Promise) {
    val parsed = try {
      requestParser.parseRequest(request)
    } catch (error: IllegalArgumentException) {
      promise.reject("LOCAL_LLM_INVALID_REQUEST", error.message, error)
      return
    }

    runtime.startStreaming(parsed, promise)
  }

  @ReactMethod
  fun cancel(requestId: String, promise: Promise) {
    runtime.cancel(requestId)
    promise.resolve(null)
  }

  override fun invalidate() {
    runtime.invalidate()
    super.invalidate()
  }
}
