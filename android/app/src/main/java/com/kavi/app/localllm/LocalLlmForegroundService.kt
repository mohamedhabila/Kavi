package com.kavi.mobile.localllm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.kavi.mobile.MainActivity
import com.kavi.mobile.R

private const val CHANNEL_ID = "kavi_local_llm"
private const val NOTIFICATION_ID = 7201

class LocalLlmForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForegroundService()
      return START_NOT_STICKY
    }

    startForegroundService()
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    timeoutHandler?.invoke()
    stopForegroundService()
  }

  private fun startForegroundService() {
    ensureNotificationChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
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

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        getString(R.string.local_llm_notification_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      ),
    )
  }

  private fun buildNotification(): Notification {
    val launchIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(getString(R.string.local_llm_notification_title))
      .setContentText(getString(R.string.local_llm_notification_body))
      .setContentIntent(launchIntent)
      .setOngoing(true)
      .setLocalOnly(true)
      .build()
  }

  companion object {
    private const val ACTION_START = "com.kavi.mobile.localllm.START"
    private const val ACTION_STOP = "com.kavi.mobile.localllm.STOP"
    @Volatile
    internal var timeoutHandler: (() -> Unit)? = null

    fun start(context: Context) {
      val intent = Intent(context, LocalLlmForegroundService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LocalLlmForegroundService::class.java).setAction(ACTION_STOP))
    }
  }
}
