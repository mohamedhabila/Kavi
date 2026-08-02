package com.kavi.mobile.longhorizon

import android.content.Context
import android.util.Log
import java.util.concurrent.CopyOnWriteArraySet

internal fun interface AndroidLongHorizonCancellationListener {
  fun onCancellationRequested(reason: AndroidLongHorizonCancellationReason)
}

internal fun interface AndroidLongHorizonCancellationEmitter {
  fun emitCancellationRequested(reason: AndroidLongHorizonCancellationReason)
}

internal fun interface AndroidLongHorizonIdleListener {
  fun onAllLeasesIdle()
}

internal fun interface AndroidLongHorizonIdleEmitter {
  fun emitAllLeasesIdle()
}

internal object AndroidLongHorizonCancellationBus : AndroidLongHorizonCancellationEmitter {
  private val listeners = CopyOnWriteArraySet<AndroidLongHorizonCancellationListener>()

  fun addListener(listener: AndroidLongHorizonCancellationListener) {
    listeners += listener
  }

  fun removeListener(listener: AndroidLongHorizonCancellationListener) {
    listeners -= listener
  }

  override fun emitCancellationRequested(reason: AndroidLongHorizonCancellationReason) {
    listeners.forEach { listener ->
      try {
        listener.onCancellationRequested(reason)
      } catch (_: Exception) {
        // One bridge listener cannot prevent the remaining owners from cancelling.
      }
    }
  }
}

internal object AndroidLongHorizonIdleBus : AndroidLongHorizonIdleEmitter {
  private val listeners = CopyOnWriteArraySet<AndroidLongHorizonIdleListener>()

  fun addListener(listener: AndroidLongHorizonIdleListener) {
    listeners += listener
  }

  fun removeListener(listener: AndroidLongHorizonIdleListener) {
    listeners -= listener
  }

  override fun emitAllLeasesIdle() {
    listeners.forEach { listener ->
      try {
        listener.onAllLeasesIdle()
      } catch (_: Exception) {
        // One bridge listener cannot prevent remaining waiters from being released.
      }
    }
  }
}

internal interface AndroidLongHorizonServiceController {
  fun start(activeLeaseCount: Int)
  fun update(activeLeaseCount: Int)
  fun stop()
}

internal class AndroidLongHorizonPlatformServiceController(
  private val context: Context,
) : AndroidLongHorizonServiceController {
  override fun start(activeLeaseCount: Int) {
    AndroidLongHorizonExecutionService.start(context)
  }

  override fun update(activeLeaseCount: Int) {
    AndroidLongHorizonExecutionService.updateNotification(context, activeLeaseCount)
  }

  override fun stop() {
    AndroidLongHorizonExecutionService.stop(context)
  }
}

internal class AndroidLongHorizonExecutionCoordinator(
  private val registry: AndroidLongHorizonLeaseRegistry,
  private val serviceController: AndroidLongHorizonServiceController,
  private val cancellationBus: AndroidLongHorizonCancellationEmitter =
    AndroidLongHorizonCancellationBus,
  private val idleBus: AndroidLongHorizonIdleEmitter = AndroidLongHorizonIdleBus,
  private val warningLogger: (String, Throwable) -> Unit = { message, error ->
    Log.w(LOG_TAG, message, error)
  },
) {
  private var hostForeground = false
  private var serviceRunning = false

  @Synchronized
  fun acquire(lease: AndroidLongHorizonLease): AndroidLongHorizonBridgeResult {
    return when (val mutation = registry.acquire(lease)) {
      is AndroidLongHorizonLeaseMutation.NoOp ->
        AndroidLongHorizonBridgeResult.NoOp(mutation.activeLeaseCount)
      is AndroidLongHorizonLeaseMutation.Accepted -> {
        try {
          ensureBackgroundService(mutation.activeLeaseCount)
          AndroidLongHorizonBridgeResult.Accepted(mutation.activeLeaseCount)
        } catch (error: Exception) {
          val rolledBack = registry.release(lease.leaseId)
          if (rolledBack.activeLeaseCount == 0) {
            idleBus.emitAllLeasesIdle()
          }
          AndroidLongHorizonBridgeResult.Unavailable(
            activeLeaseCount = rolledBack.activeLeaseCount,
            reason = classifyStartFailure(error),
          )
        }
      }
      else -> error("Unexpected lease acquisition mutation: $mutation")
    }
  }

  @Synchronized
  fun release(leaseId: String): AndroidLongHorizonBridgeResult {
    return when (val mutation = registry.release(leaseId)) {
      is AndroidLongHorizonLeaseMutation.Missing ->
        AndroidLongHorizonBridgeResult.Missing(mutation.activeLeaseCount)
      is AndroidLongHorizonLeaseMutation.Released -> {
        if (mutation.activeLeaseCount == 0) {
          val shouldStopService = serviceRunning
          serviceRunning = false
          idleBus.emitAllLeasesIdle()
          if (shouldStopService) {
            stopServiceBestEffort()
          }
        } else if (serviceRunning) {
          updateServiceBestEffort(mutation.activeLeaseCount)
        }
        AndroidLongHorizonBridgeResult.Released(mutation.activeLeaseCount)
      }
      else -> error("Unexpected lease release mutation: $mutation")
    }
  }

  @Synchronized
  fun activeLeaseCount(): Int = registry.size()

  @Synchronized
  fun shouldRunService(): Boolean = registry.size() > 0

  @Synchronized
  fun onHostForegrounded() {
    hostForeground = true
  }

  @Synchronized
  fun onHostBackgrounded() {
    hostForeground = false
    val activeLeaseCount = registry.size()
    if (activeLeaseCount == 0 || serviceRunning) return
    try {
      serviceController.start(activeLeaseCount)
      serviceRunning = true
    } catch (error: Exception) {
      warningLogger(
        "Android could not grant background continuity for active assistant work.",
        error,
      )
      serviceRunning = false
      val hadActiveWork = registry.clear() > 0
      stopServiceBestEffort()
      if (hadActiveWork) {
        cancellationBus.emitCancellationRequested(
          AndroidLongHorizonCancellationReason.BACKGROUND_CONTINUITY_UNAVAILABLE,
        )
        idleBus.emitAllLeasesIdle()
      }
    }
  }

  @Synchronized
  fun cancelFromUser() {
    val hadActiveWork = registry.clear() > 0
    serviceRunning = false
    stopServiceBestEffort()
    if (hadActiveWork) {
      cancellationBus.emitCancellationRequested(AndroidLongHorizonCancellationReason.USER_REQUESTED)
      idleBus.emitAllLeasesIdle()
    }
  }

  @Synchronized
  fun clearForBridgeInvalidation() {
    val hadActiveWork = registry.clear() > 0
    serviceRunning = false
    stopServiceBestEffort()
    if (hadActiveWork) {
      idleBus.emitAllLeasesIdle()
    }
  }

  @Synchronized
  fun handleBackgroundSchedulerUnavailable() {
    if (!serviceRunning) return
    serviceRunning = false
    val hadActiveWork = registry.clear() > 0
    if (hadActiveWork) {
      cancellationBus.emitCancellationRequested(
        AndroidLongHorizonCancellationReason.BACKGROUND_CONTINUITY_UNAVAILABLE,
      )
      idleBus.emitAllLeasesIdle()
    }
  }

  @Synchronized
  fun handleUnexpectedServiceStop() {
    if (!serviceRunning) return
    serviceRunning = false
    if (!hostForeground) {
      val hadActiveWork = registry.clear() > 0
      if (hadActiveWork) {
        cancellationBus.emitCancellationRequested(
          AndroidLongHorizonCancellationReason.SERVICE_STOPPED_UNEXPECTEDLY,
        )
        idleBus.emitAllLeasesIdle()
      }
    }
  }

  private fun ensureBackgroundService(activeLeaseCount: Int) {
    if (serviceRunning) {
      serviceController.update(activeLeaseCount)
      return
    }
    if (hostForeground) return
    serviceController.start(activeLeaseCount)
    serviceRunning = true
  }

  private fun classifyStartFailure(error: Throwable): AndroidLongHorizonUnavailableReason = when {
    error.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException" ->
      AndroidLongHorizonUnavailableReason.FOREGROUND_SERVICE_START_NOT_ALLOWED
    error is SecurityException ->
      AndroidLongHorizonUnavailableReason.FOREGROUND_SERVICE_PERMISSION_MISSING
    else -> AndroidLongHorizonUnavailableReason.FOREGROUND_SERVICE_START_FAILED
  }

  private fun updateServiceBestEffort(activeLeaseCount: Int) {
    try {
      serviceController.update(activeLeaseCount)
    } catch (error: Exception) {
      warningLogger("Failed to update long-horizon execution notification.", error)
    }
  }

  private fun stopServiceBestEffort() {
    try {
      serviceController.stop()
    } catch (error: Exception) {
      warningLogger("Failed to stop long-horizon execution service.", error)
    }
  }

  private companion object {
    const val LOG_TAG = "KaviLongHorizon"
  }
}

internal class AndroidLongHorizonExecutionRuntime private constructor(context: Context) {
  val coordinator = AndroidLongHorizonExecutionCoordinator(
    registry = AndroidLongHorizonLeaseRegistry(),
    serviceController = AndroidLongHorizonPlatformServiceController(context.applicationContext),
  )

  companion object {
    @Volatile
    private var instance: AndroidLongHorizonExecutionRuntime? = null

    fun get(context: Context): AndroidLongHorizonExecutionRuntime =
      instance ?: synchronized(this) {
        instance ?: AndroidLongHorizonExecutionRuntime(context.applicationContext).also {
          instance = it
        }
      }
  }
}
