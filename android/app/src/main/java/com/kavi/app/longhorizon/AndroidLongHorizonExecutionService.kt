package com.kavi.mobile.longhorizon

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import com.kavi.mobile.MainActivity
import com.kavi.mobile.R

private const val CHANNEL_ID = "kavi_long_horizon_execution"
private const val NOTIFICATION_ID = 7301
private const val WAKE_LOCK_TAG = "com.kavi.mobile:long-horizon-execution"
private const val WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L
private const val WAKE_LOCK_RENEWAL_MS = 5L * 60L * 60L * 1000L
private const val HEADLESS_TASK_CLEANUP_GRACE_MS = 5_000L
private const val MAX_HEADLESS_TASK_RESTARTS = 1
private const val LOG_TAG = "KaviLongHorizon"

/** User-visible lifetime owner for assistant work that began from the chat UI. */
class AndroidLongHorizonExecutionService : Service(), HeadlessJsTaskEventListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var executionWakeLock: PowerManager.WakeLock? = null
  private var headlessTaskContext: HeadlessJsTaskContext? = null
  private var headlessTaskId: Int? = null
  private var headlessTaskRestartCount = 0
  private var destroyed = false
  private val renewWakeLock = Runnable {
    if (destroyed) return@Runnable
    executionWakeLock?.let { wakeLock ->
      if (wakeLock.isHeld) wakeLock.release()
    }
    executionWakeLock = null
    acquireExecutionWakeLock()
  }
  private val finishHeadlessTaskFallback = Runnable {
    finishHeadlessTaskIfRunning()
    releaseExecutionWakeLock()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_CANCEL) {
      AndroidLongHorizonExecutionRuntime.get(this).coordinator.cancelFromUser()
      stopForegroundService()
      return START_NOT_STICKY
    }

    val coordinator = AndroidLongHorizonExecutionRuntime.get(this).coordinator
    val activeLeaseCount = coordinator.activeLeaseCount()
    if (activeLeaseCount < 1 || !coordinator.shouldRunService()) {
      stopForegroundService()
      return START_NOT_STICKY
    }

    ensureNotificationChannel(this)
    val notification = buildNotification(this, activeLeaseCount)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireExecutionWakeLock()
    if (!ensureBackgroundHeadlessTask()) {
      Log.w(
        LOG_TAG,
        "React context was unavailable for background execution; cancelling live ownership.",
      )
      coordinator.handleBackgroundSchedulerUnavailable()
      stopForegroundService()
      return START_NOT_STICKY
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    destroyed = true
    AndroidLongHorizonExecutionRuntime.get(this).coordinator.handleUnexpectedServiceStop()
    if (headlessTaskId == null) {
      releaseExecutionWakeLock()
    } else {
      // The idle signal is emitted before normal and unexpected service teardown. Keep the CPU
      // awake briefly so the JS promise can settle and remove React Native's active task marker.
      mainHandler.postDelayed(finishHeadlessTaskFallback, HEADLESS_TASK_CLEANUP_GRACE_MS)
    }
    super.onDestroy()
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != headlessTaskId) return
    mainHandler.removeCallbacks(finishHeadlessTaskFallback)
    headlessTaskContext?.removeTaskEventListener(this)
    headlessTaskContext = null
    headlessTaskId = null

    if (destroyed) {
      releaseExecutionWakeLock()
      return
    }
    val coordinator = AndroidLongHorizonExecutionRuntime.get(this).coordinator
    if (coordinator.shouldRunService() && headlessTaskRestartCount < MAX_HEADLESS_TASK_RESTARTS) {
      headlessTaskRestartCount += 1
      Log.w(LOG_TAG, "Background JS owner ended while work was active; restarting once.")
      if (!ensureBackgroundHeadlessTask()) {
        coordinator.handleBackgroundSchedulerUnavailable()
        stopForegroundService()
      }
    } else if (coordinator.shouldRunService()) {
      Log.e(LOG_TAG, "Background JS owner ended repeatedly; cancelling live ownership.")
      coordinator.handleBackgroundSchedulerUnavailable()
      stopForegroundService()
    }
  }

  private fun stopForegroundService() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun acquireExecutionWakeLock() {
    if (executionWakeLock?.isHeld == true) return
    executionWakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
      .apply {
        setReferenceCounted(false)
        acquire(WAKE_LOCK_TIMEOUT_MS)
      }
    mainHandler.removeCallbacks(renewWakeLock)
    mainHandler.postDelayed(renewWakeLock, WAKE_LOCK_RENEWAL_MS)
  }

  private fun releaseExecutionWakeLock() {
    mainHandler.removeCallbacks(renewWakeLock)
    executionWakeLock?.let { wakeLock ->
      if (wakeLock.isHeld) {
        wakeLock.release()
      }
    }
    executionWakeLock = null
  }

  private fun ensureBackgroundHeadlessTask(): Boolean {
    val existingTaskId = headlessTaskId
    if (existingTaskId != null && headlessTaskContext?.isTaskRunning(existingTaskId) == true) {
      return true
    }
    val reactApplication = application as? ReactApplication ?: return false
    val reactContext = reactApplication.reactHost?.currentReactContext ?: return false
    val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
    val data = Arguments.createMap().apply {
      putInt("schema", ANDROID_LONG_HORIZON_BRIDGE_SCHEMA)
    }
    return try {
      taskContext.addTaskEventListener(this)
      val taskId = taskContext.startTask(
        HeadlessJsTaskConfig(
          ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY,
          data,
          0L,
          true,
        ),
      )
      headlessTaskContext = taskContext
      headlessTaskId = taskId
      true
    } catch (error: Exception) {
      taskContext.removeTaskEventListener(this)
      Log.w(LOG_TAG, "Failed to start React Native background execution owner.", error)
      false
    }
  }

  private fun finishHeadlessTaskIfRunning() {
    val taskContext = headlessTaskContext
    val taskId = headlessTaskId
    if (taskContext != null && taskId != null && taskContext.isTaskRunning(taskId)) {
      taskContext.finishTask(taskId)
    }
    taskContext?.removeTaskEventListener(this)
    headlessTaskContext = null
    headlessTaskId = null
  }

  companion object {
    private const val ACTION_START = "com.kavi.mobile.longhorizon.START"
    private const val ACTION_CANCEL = "com.kavi.mobile.longhorizon.CANCEL"

    fun start(context: Context) {
      val intent = Intent(context, AndroidLongHorizonExecutionService::class.java)
        .setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun updateNotification(context: Context, activeLeaseCount: Int) {
      if (activeLeaseCount < 1) return
      ensureNotificationChannel(context)
      context.getSystemService(NotificationManager::class.java).notify(
        NOTIFICATION_ID,
        buildNotification(context, activeLeaseCount),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, AndroidLongHorizonExecutionService::class.java))
    }

    private fun ensureNotificationChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          context.getString(R.string.long_horizon_notification_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }

    private fun buildNotification(context: Context, activeLeaseCount: Int): Notification {
      val openIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val cancelIntent = PendingIntent.getService(
        context,
        1,
        Intent(context, AndroidLongHorizonExecutionService::class.java).setAction(ACTION_CANCEL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      return builder
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(context.getString(R.string.long_horizon_notification_title))
        .setContentText(
          context.resources.getQuantityString(
            R.plurals.long_horizon_notification_body,
            activeLeaseCount,
            activeLeaseCount,
          ),
        )
        .setContentIntent(openIntent)
        .setCategory(Notification.CATEGORY_PROGRESS)
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .setShowWhen(false)
        .addAction(
          Notification.Action.Builder(
            Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
            context.getString(R.string.long_horizon_notification_stop),
            cancelIntent,
          ).build(),
        )
        .build()
    }
  }
}
