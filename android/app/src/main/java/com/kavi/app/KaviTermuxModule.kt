package com.kavi.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class KaviTermuxModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TERMUX_PACKAGE_NAME = "com.termux"
    private const val TERMUX_BASH_PATH = "/data/data/com.termux/files/usr/bin/bash"
    private const val ACTION_RUN_COMMAND = "$TERMUX_PACKAGE_NAME.RUN_COMMAND"
    private const val EXTRA_COMMAND_PATH = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_PATH"
    private const val EXTRA_ARGUMENTS = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_ARGUMENTS"
    private const val EXTRA_STDIN = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_STDIN"
    private const val EXTRA_WORKDIR = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_WORKDIR"
    private const val EXTRA_RUNNER = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_RUNNER"
    private const val EXTRA_PENDING_INTENT = "$TERMUX_PACKAGE_NAME.RUN_COMMAND_PENDING_INTENT"
    private const val RUNNER_APP_SHELL = "app-shell"

    private const val RESULT_BUNDLE_KEY = "result"
    private const val RESULT_STDOUT_KEY = "stdout"
    private const val RESULT_STDOUT_ORIGINAL_LENGTH_KEY = "stdout_original_length"
    private const val RESULT_STDERR_KEY = "stderr"
    private const val RESULT_STDERR_ORIGINAL_LENGTH_KEY = "stderr_original_length"
    private const val RESULT_EXIT_CODE_KEY = "exitCode"
    private const val RESULT_ERR_CODE_KEY = "err"
    private const val RESULT_ERRMSG_KEY = "errmsg"

    private const val DEFAULT_TIMEOUT_MS = 30_000L
  }

  private data class PendingRequest(
    val receiver: BroadcastReceiver,
    val timeoutRunnable: Runnable,
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val pendingRequests = ConcurrentHashMap<String, PendingRequest>()

  override fun getName(): String = "KaviTermux"

  @ReactMethod
  fun getAvailability(promise: Promise) {
    try {
      val packageInfo = getPackageInfo(TERMUX_PACKAGE_NAME)
      val runCommandIntent = Intent(ACTION_RUN_COMMAND).setPackage(TERMUX_PACKAGE_NAME)
      val serviceAvailable = resolveService(runCommandIntent)

      val result = Arguments.createMap()
      val installed = packageInfo != null
      result.putBoolean("available", installed)
      result.putBoolean("serviceAvailable", serviceAvailable)
      result.putString("packageName", TERMUX_PACKAGE_NAME)
      if (packageInfo?.versionName != null) {
        result.putString("versionName", packageInfo.versionName)
      } else {
        result.putNull("versionName")
      }
      if (packageInfo != null) {
        result.putDouble("versionCode", getLongVersionCode(packageInfo).toDouble())
      } else {
        result.putNull("versionCode")
      }

      val reason = when {
        !installed -> "Install Termux to enable real local shell commands on Android."
        !serviceAvailable -> "Termux is installed, but the RUN_COMMAND service is not available."
        else -> null
      }
      if (reason != null) {
        result.putString("reason", reason)
      } else {
        result.putNull("reason")
      }

      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("TERMUX_AVAILABILITY_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun execute(
    command: String,
    workingDirectory: String?,
    stdin: String?,
    timeoutMs: Double,
    promise: Promise,
  ) {
    if (command.isBlank()) {
      promise.reject("TERMUX_INVALID_COMMAND", "Command must not be empty.")
      return
    }

    if (getPackageInfo(TERMUX_PACKAGE_NAME) == null) {
      promise.reject("TERMUX_UNAVAILABLE", "Termux is not installed.")
      return
    }

    val serviceIntent = Intent(ACTION_RUN_COMMAND).setPackage(TERMUX_PACKAGE_NAME)
    if (!resolveService(serviceIntent)) {
      promise.reject("TERMUX_UNAVAILABLE", "Termux RUN_COMMAND service is unavailable.")
      return
    }

    val requestId = UUID.randomUUID().toString()
    val action = "${reactContext.packageName}.TERMUX_RESULT.$requestId"
    val requestCode = requestId.hashCode()
    val startedAt = System.currentTimeMillis()
    val timeout = timeoutMs.toLong().takeIf { it > 0 } ?: DEFAULT_TIMEOUT_MS

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        cleanupRequest(action)

        val resultBundle = intent?.getBundleExtra(RESULT_BUNDLE_KEY)
        if (resultBundle == null) {
          promise.reject("TERMUX_NO_RESULT", "Termux completed without returning a result bundle.")
          return
        }

        promise.resolve(createResultMap(resultBundle, startedAt))
      }
    }

    registerReceiver(action, receiver)

    val timeoutRunnable = Runnable {
      cleanupRequest(action)
      promise.reject("TERMUX_TIMEOUT", "Timed out waiting for Termux command result after ${timeout}ms.")
    }

    pendingRequests[action] = PendingRequest(receiver, timeoutRunnable)
    mainHandler.postDelayed(timeoutRunnable, timeout)

    try {
      val pendingIntent = PendingIntent.getBroadcast(
        reactContext,
        requestCode,
        Intent(action).setPackage(reactContext.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
      )

      serviceIntent.putExtra(EXTRA_COMMAND_PATH, TERMUX_BASH_PATH)
      serviceIntent.putExtra(EXTRA_ARGUMENTS, arrayOf("-lc", command))
      serviceIntent.putExtra(EXTRA_RUNNER, RUNNER_APP_SHELL)
      serviceIntent.putExtra(EXTRA_PENDING_INTENT, pendingIntent)
      if (!workingDirectory.isNullOrBlank()) {
        serviceIntent.putExtra(EXTRA_WORKDIR, workingDirectory)
      }
      if (!stdin.isNullOrEmpty()) {
        serviceIntent.putExtra(EXTRA_STDIN, stdin)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactContext.startForegroundService(serviceIntent)
      } else {
        reactContext.startService(serviceIntent)
      }
    } catch (error: Exception) {
      cleanupRequest(action)
      promise.reject("TERMUX_EXECUTION_FAILED", error.message, error)
    }
  }

  override fun invalidate() {
    super.invalidate()
    for (action in pendingRequests.keys) {
      cleanupRequest(action)
    }
  }

  private fun createResultMap(resultBundle: Bundle, startedAt: Long) = Arguments.createMap().apply {
    val stdout = resultBundle.getString(RESULT_STDOUT_KEY).orEmpty()
    val stderr = resultBundle.getString(RESULT_STDERR_KEY).orEmpty()
    val errCode = resultBundle.getInt(RESULT_ERR_CODE_KEY, -1)
    val exitCodePresent = resultBundle.containsKey(RESULT_EXIT_CODE_KEY)
    val exitCode = if (exitCodePresent) resultBundle.getInt(RESULT_EXIT_CODE_KEY) else null
    val stdoutOriginalLength = resultBundle.getString(RESULT_STDOUT_ORIGINAL_LENGTH_KEY)?.toIntOrNull()
    val stderrOriginalLength = resultBundle.getString(RESULT_STDERR_ORIGINAL_LENGTH_KEY)?.toIntOrNull()
    val errorMessage = resultBundle.getString(RESULT_ERRMSG_KEY)

    putString("stdout", stdout)
    putString("stderr", stderr)
    if (exitCode != null) {
      putInt("exitCode", exitCode)
    } else {
      putNull("exitCode")
    }
    putInt("errCode", errCode)
    if (errorMessage != null) {
      putString("errorMessage", errorMessage)
    } else {
      putNull("errorMessage")
    }
    if (stdoutOriginalLength != null) {
      putInt("stdoutOriginalLength", stdoutOriginalLength)
    } else {
      putNull("stdoutOriginalLength")
    }
    if (stderrOriginalLength != null) {
      putInt("stderrOriginalLength", stderrOriginalLength)
    } else {
      putNull("stderrOriginalLength")
    }
    putDouble("durationMs", (System.currentTimeMillis() - startedAt).toDouble())
  }

  private fun cleanupRequest(action: String) {
    val pending = pendingRequests.remove(action) ?: return
    mainHandler.removeCallbacks(pending.timeoutRunnable)
    try {
      reactContext.unregisterReceiver(pending.receiver)
    } catch (_: IllegalArgumentException) {
    }
  }

  private fun registerReceiver(action: String, receiver: BroadcastReceiver) {
    val filter = IntentFilter(action)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(receiver, filter)
    }
  }

  private fun resolveService(intent: Intent): Boolean {
    val packageManager = reactContext.packageManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.resolveService(intent, PackageManager.ResolveInfoFlags.of(0)) != null
    } else {
      @Suppress("DEPRECATION")
      packageManager.resolveService(intent, 0) != null
    }
  }

  private fun getPackageInfo(packageName: String): PackageInfo? {
    val packageManager = reactContext.packageManager
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(packageName, 0)
      }
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }
  }

  private fun getLongVersionCode(packageInfo: PackageInfo): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toLong()
    }
  }

  private fun immutableFlag(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }
  }
}