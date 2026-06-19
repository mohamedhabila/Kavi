package com.kavi.mobile.localllm

import android.app.ActivityManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap

internal class LocalLlmDeviceInfo(
  private val reactContext: ReactApplicationContext,
) {
  fun buildAvailabilityMap(metrics: RuntimeMetrics): WritableMap {
    val deviceMemoryGb = getDeviceMemoryGb()
    val lowMemoryDevice = isLowMemoryDevice()
    val reason = if (lowMemoryDevice) {
      "This device reports Android low-RAM mode, which is not supported for on-device model inference."
    } else {
      null
    }

    return Arguments.createMap().apply {
      putBoolean("available", !lowMemoryDevice)
      putBoolean("linked", true)
      putString("platform", "android")
      putString("runtime", "litert-lm")
      putBoolean("supportsStreaming", true)
      putArray("supportedAccelerators", buildSupportedAcceleratorsArray())
      putBoolean("lowMemoryDevice", lowMemoryDevice)
      if (deviceMemoryGb != null) {
        putDouble("deviceMemoryGb", deviceMemoryGb)
      } else {
        putNull("deviceMemoryGb")
      }
      if (reason != null) {
        putString("reason", reason)
      } else {
        putNull("reason")
      }
      putMap("accelerationFeatures", metrics.accelerationFeaturesToWritableMap())
      putMap("runtimeMetrics", metrics.toWritableMap())
    }
  }

  fun validateRequestEnvironment(request: EngineRequest) {
    if (isLowMemoryDevice()) {
      throw IllegalStateException("This device reports Android low-RAM mode, which is not supported for on-device model inference.")
    }

    val minDeviceMemoryGb = request.minDeviceMemoryGb ?: return
    val deviceMemoryGb = getDeviceMemoryGb() ?: return
    val hardBlockFloorGb = minDeviceMemoryGb.toDouble() * MEMORY_HARD_BLOCK_RATIO
    if (deviceMemoryGb + MEMORY_EPSILON_GB < hardBlockFloorGb) {
      throw IllegalStateException(
        "This device reports about ${formatMemoryGb(deviceMemoryGb)} GB of memory, but the selected on-device model is recommended for devices with at least $minDeviceMemoryGb GB and is blocked here to avoid startup failures.",
      )
    }
  }

  private fun getActivityManager(): ActivityManager? {
    return reactContext.getSystemService(ActivityManager::class.java)
  }

  private fun getDeviceMemoryGb(): Double? {
    val activityManager = getActivityManager() ?: return null
    val memoryInfo = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(memoryInfo)
    val totalBytes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      memoryInfo.advertisedMem.toDouble()
    } else {
      memoryInfo.totalMem.toDouble()
    }
    return totalBytes / BYTES_IN_GB
  }

  private fun isLowMemoryDevice(): Boolean {
    return getActivityManager()?.isLowRamDevice ?: false
  }

  private fun formatMemoryGb(value: Double): String {
    return "%.1f".format(value)
  }

  private fun buildSupportedAcceleratorsArray() = Arguments.createArray().apply {
    LOCAL_LLM_ACCELERATORS.forEach(::pushString)
  }
}
