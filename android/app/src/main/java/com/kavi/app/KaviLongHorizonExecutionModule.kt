package com.kavi.mobile

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.kavi.mobile.longhorizon.ANDROID_LONG_HORIZON_BRIDGE_SCHEMA
import com.kavi.mobile.longhorizon.ANDROID_LONG_HORIZON_CANCEL_EVENT
import com.kavi.mobile.longhorizon.ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY
import com.kavi.mobile.longhorizon.AndroidLongHorizonBridgeResult
import com.kavi.mobile.longhorizon.AndroidLongHorizonCancellationBus
import com.kavi.mobile.longhorizon.AndroidLongHorizonCancellationListener
import com.kavi.mobile.longhorizon.AndroidLongHorizonExecutionRuntime
import com.kavi.mobile.longhorizon.AndroidLongHorizonIdleBus
import com.kavi.mobile.longhorizon.AndroidLongHorizonIdleListener
import com.kavi.mobile.longhorizon.AndroidLongHorizonLease
import com.kavi.mobile.longhorizon.AndroidLongHorizonTaskKind

private const val KAVI_LONG_HORIZON_EXECUTION_MODULE_NAME = "KaviLongHorizonExecution"

class KaviLongHorizonExecutionModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val runtime = AndroidLongHorizonExecutionRuntime.get(reactContext.applicationContext)
  private val idleWaiterLock = Any()
  private val idleWaiters = linkedSetOf<Promise>()
  private val cancellationListener = AndroidLongHorizonCancellationListener { reason ->
    try {
      val payload = Arguments.createMap().apply {
        putInt("schema", ANDROID_LONG_HORIZON_BRIDGE_SCHEMA)
        putString("reason", reason.bridgeName)
      }
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(ANDROID_LONG_HORIZON_CANCEL_EVENT, payload)
    } catch (_: Exception) {
      // Persisted run state remains the fallback if the bridge is already shutting down.
    }
  }
  private val idleListener = AndroidLongHorizonIdleListener {
    resolveIdleWaiters()
  }

  init {
    AndroidLongHorizonCancellationBus.addListener(cancellationListener)
    AndroidLongHorizonIdleBus.addListener(idleListener)
  }

  override fun getName(): String = KAVI_LONG_HORIZON_EXECUTION_MODULE_NAME

  override fun getConstants(): Map<String, Any> = mapOf(
    "bridgeSchema" to ANDROID_LONG_HORIZON_BRIDGE_SCHEMA,
    "cancelEventName" to ANDROID_LONG_HORIZON_CANCEL_EVENT,
    "keepAliveTaskKey" to ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY,
  )

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by NativeEventEmitter.
  }

  @ReactMethod
  fun acquire(leaseId: String, taskKind: String, promise: Promise) {
    val decodedLeaseId = decodeLeaseId(leaseId, promise) ?: return
    val decodedTaskKind = AndroidLongHorizonTaskKind.fromBridgeName(taskKind)
    if (decodedTaskKind == null) {
      promise.reject(ERROR_CONTRACT, "Android long-horizon task kind is invalid.")
      return
    }
    promise.resolve(
      encodeResult(
        runtime.coordinator.acquire(AndroidLongHorizonLease(decodedLeaseId, decodedTaskKind)),
      ),
    )
  }

  @ReactMethod
  fun release(leaseId: String, promise: Promise) {
    val decodedLeaseId = decodeLeaseId(leaseId, promise) ?: return
    promise.resolve(encodeResult(runtime.coordinator.release(decodedLeaseId)))
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val result = Arguments.createMap().apply {
      putInt("schema", ANDROID_LONG_HORIZON_BRIDGE_SCHEMA)
      putInt("activeLeaseCount", runtime.coordinator.activeLeaseCount())
    }
    promise.resolve(result)
  }

  @ReactMethod
  fun awaitIdle(promise: Promise) {
    val resolveImmediately = synchronized(idleWaiterLock) {
      if (runtime.coordinator.activeLeaseCount() == 0) {
        true
      } else {
        idleWaiters += promise
        false
      }
    }
    if (resolveImmediately) {
      promise.resolve(encodeIdleResult())
    }
  }

  override fun invalidate() {
    runtime.coordinator.clearForBridgeInvalidation()
    resolveIdleWaiters()
    AndroidLongHorizonCancellationBus.removeListener(cancellationListener)
    AndroidLongHorizonIdleBus.removeListener(idleListener)
    super.invalidate()
  }

  private fun resolveIdleWaiters() {
    val waiters = synchronized(idleWaiterLock) {
      idleWaiters.toList().also { idleWaiters.clear() }
    }
    waiters.forEach { promise -> promise.resolve(encodeIdleResult()) }
  }

  private fun encodeIdleResult() = Arguments.createMap().apply {
    putInt("schema", ANDROID_LONG_HORIZON_BRIDGE_SCHEMA)
    putString("status", "idle")
    putInt("activeLeaseCount", 0)
  }

  private fun decodeLeaseId(value: String, promise: Promise): String? {
    val valid = value.isNotEmpty() &&
      value.length <= MAX_LEASE_ID_LENGTH &&
      value == value.trim() &&
      value.none { character -> character.code < 0x20 || character.code == 0x7f }
    if (!valid) {
      promise.reject(ERROR_CONTRACT, "Android long-horizon lease id is invalid.")
      return null
    }
    return value
  }

  private fun encodeResult(result: AndroidLongHorizonBridgeResult) =
    Arguments.createMap().apply {
      putInt("schema", ANDROID_LONG_HORIZON_BRIDGE_SCHEMA)
      putInt("activeLeaseCount", result.activeLeaseCount)
      when (result) {
        is AndroidLongHorizonBridgeResult.Accepted -> {
          putString("status", "accepted")
          putNull("reason")
        }
        is AndroidLongHorizonBridgeResult.NoOp -> {
          putString("status", "no_op")
          putNull("reason")
        }
        is AndroidLongHorizonBridgeResult.Released -> {
          putString("status", "released")
          putNull("reason")
        }
        is AndroidLongHorizonBridgeResult.Missing -> {
          putString("status", "missing")
          putNull("reason")
        }
        is AndroidLongHorizonBridgeResult.Unavailable -> {
          putString("status", "unavailable")
          putString("reason", result.reason.bridgeName)
        }
      }
    }

  private companion object {
    const val MAX_LEASE_ID_LENGTH = 200
    const val ERROR_CONTRACT = "LONG_HORIZON_EXECUTION_CONTRACT_VIOLATION"
  }
}
