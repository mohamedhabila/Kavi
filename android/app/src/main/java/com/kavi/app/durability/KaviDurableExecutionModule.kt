package com.kavi.mobile.durability

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

internal const val KAVI_DURABLE_EXECUTION_MODULE_NAME = "KaviDurableExecution"

internal class KaviDurableExecutionModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val applicationContext = reactContext.applicationContext
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "kavi-durable-execution-bridge")
  }
  private val runtime by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
    AndroidDurableExecutionRuntime.get(applicationContext)
  }

  override fun getName(): String = KAVI_DURABLE_EXECUTION_MODULE_NAME

  override fun getConstants(): Map<String, Any> = mapOf(
    "bridgeSchema" to ANDROID_DURABLE_BRIDGE_SCHEMA,
    "headlessTaskKey" to ANDROID_DURABLE_HEADLESS_TASK_KEY,
  )

  @ReactMethod
  fun enqueue(requestMap: ReadableMap, promise: Promise) = decodeAndSubmit(
    promise = promise,
    decode = { AndroidDurableBridgeCodec.decodeRequest(requestMap) },
  ) { request ->
    AndroidDurableBridgeCodec.encodeAdapterResult(runtime.adapter.enqueue(request))
  }

  @ReactMethod
  fun cancel(
    pointerMap: ReadableMap,
    updatedAtMillis: Double,
    promise: Promise,
  ) = decodeAndSubmit(
    promise = promise,
    decode = {
      AndroidDurableBridgeCodec.decodePointer(pointerMap) to
        AndroidDurableBridgeCodec.decodeTimestamp(updatedAtMillis, "updatedAtMillis")
    },
  ) { (pointer, updatedAt) ->
    AndroidDurableBridgeCodec.encodeAdapterResult(runtime.adapter.cancel(pointer, updatedAt))
  }

  @ReactMethod
  fun complete(
    pointerMap: ReadableMap,
    receiptDigest: String,
    updatedAtMillis: Double,
    promise: Promise,
  ) = decodeAndSubmit(
    promise = promise,
    decode = {
      Triple(
        AndroidDurableBridgeCodec.decodeAttemptPointer(pointerMap),
        receiptDigest,
        AndroidDurableBridgeCodec.decodeTimestamp(updatedAtMillis, "updatedAtMillis"),
      )
    },
  ) { (pointer, receipt, updatedAt) ->
    AndroidDurableBridgeCodec.encodeAdapterResult(
      runtime.adapter.complete(pointer, receipt, updatedAt),
    )
  }

  @ReactMethod
  fun scheduleRetry(
    pointerMap: ReadableMap,
    nextAttemptAtMillis: Double,
    failureReason: String,
    updatedAtMillis: Double,
    promise: Promise,
  ) = decodeAndSubmit(
    promise = promise,
    decode = {
      RetryInput(
        pointer = AndroidDurableBridgeCodec.decodeAttemptPointer(pointerMap),
        nextAttemptAtMillis = AndroidDurableBridgeCodec.decodeTimestamp(
          nextAttemptAtMillis,
          "nextAttemptAtMillis",
        ),
        failureReason = AndroidDurableBridgeCodec.decodeRetryReason(failureReason),
        updatedAtMillis = AndroidDurableBridgeCodec.decodeTimestamp(
          updatedAtMillis,
          "updatedAtMillis",
        ),
      )
    },
  ) { input ->
    AndroidDurableBridgeCodec.encodeAdapterResult(
      runtime.adapter.scheduleRetry(
        pointer = input.pointer,
        nextAttemptAtMillis = input.nextAttemptAtMillis,
        failureReason = input.failureReason,
        updatedAtMillis = input.updatedAtMillis,
      ),
    )
  }

  @ReactMethod
  fun block(
    pointerMap: ReadableMap,
    failureReason: String,
    updatedAtMillis: Double,
    promise: Promise,
  ) = decodeAndSubmit(
    promise = promise,
    decode = {
      BlockInput(
        pointer = AndroidDurableBridgeCodec.decodeAttemptPointer(pointerMap),
        failureReason = AndroidDurableBridgeCodec.decodeBlockReason(failureReason),
        updatedAtMillis = AndroidDurableBridgeCodec.decodeTimestamp(
          updatedAtMillis,
          "updatedAtMillis",
        ),
      )
    },
  ) { input ->
    AndroidDurableBridgeCodec.encodeAdapterResult(
      runtime.adapter.block(input.pointer, input.failureReason, input.updatedAtMillis),
    )
  }

  @ReactMethod
  fun releaseTerminal(pointerMap: ReadableMap, promise: Promise) = decodeAndSubmit(
    promise = promise,
    decode = { AndroidDurableBridgeCodec.decodePointer(pointerMap) },
  ) { pointer ->
    AndroidDurableBridgeCodec.encodeAdapterResult(runtime.adapter.releaseTerminal(pointer))
  }

  @ReactMethod
  fun getRecord(runId: String, promise: Promise) = decodeAndSubmit(
    promise = promise,
    decode = { AndroidDurableBridgeCodec.decodeRunId(runId) },
  ) { exactRunId ->
    AndroidDurableBridgeCodec.encodeReadResult(runtime.store.read(exactRunId))
  }

  @ReactMethod
  fun reconcileOutboxes(limit: Double, promise: Promise) = decodeAndSubmit(
    promise = promise,
    decode = { AndroidDurableBridgeCodec.decodeLimit(limit) },
  ) { exactLimit ->
    AndroidDurableBridgeCodec.encodeReconciliation(runtime.reconcileOutboxes(exactLimit))
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  private fun <T> decodeAndSubmit(
    promise: Promise,
    decode: () -> T,
    operation: (T) -> Any?,
  ) {
    val input = try {
      decode()
    } catch (error: AndroidDurableBridgeContractException) {
      promise.reject(ERROR_CONTRACT, error.message)
      return
    } catch (error: Exception) {
      promise.reject(ERROR_CONTRACT, "Android durable execution input is invalid.", error)
      return
    }
    try {
      executor.execute {
        try {
          promise.resolve(operation(input))
        } catch (error: Exception) {
          promise.reject(ERROR_RUNTIME, "Android durable execution failed.", error)
        }
      }
    } catch (error: RejectedExecutionException) {
      promise.reject(ERROR_RUNTIME, "Android durable execution is shutting down.", error)
    }
  }

  private data class RetryInput(
    val pointer: AndroidDurableExecutionAttemptPointer,
    val nextAttemptAtMillis: Long,
    val failureReason: AndroidDurableFailureReason,
    val updatedAtMillis: Long,
  )

  private data class BlockInput(
    val pointer: AndroidDurableExecutionAttemptPointer,
    val failureReason: AndroidDurableFailureReason,
    val updatedAtMillis: Long,
  )

  private companion object {
    const val ERROR_CONTRACT = "DURABLE_EXECUTION_CONTRACT_VIOLATION"
    const val ERROR_RUNTIME = "DURABLE_EXECUTION_FAILED"
  }
}
