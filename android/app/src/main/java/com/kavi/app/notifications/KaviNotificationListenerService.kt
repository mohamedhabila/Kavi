package com.kavi.mobile.notifications

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * Hears the notifications other apps show, once the person turns on notification access for
 * Kavi in the system settings, and keeps them in [KaviNotificationLog.shared] so Kavi can read
 * them back when asked. Nothing leaves the phone from here; nothing is kept on disk.
 */
class KaviNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    connected = this
    try {
      activeNotifications?.forEach(::record)
    } catch (error: SecurityException) {
      Log.w(TAG, "Active notifications are not readable yet.", error)
    }
  }

  override fun onListenerDisconnected() {
    if (connected === this) connected = null
  }

  override fun onNotificationPosted(notification: StatusBarNotification) {
    record(notification)
  }

  private fun record(notification: StatusBarNotification) {
    toRecord(notification)?.let(KaviNotificationLog.shared::add)
  }

  private fun toRecord(notification: StatusBarNotification): KaviNotificationRecord? {
    val flags = notification.notification.flags
    if (notification.packageName == packageName) return null
    if (flags and Notification.FLAG_GROUP_SUMMARY != 0) return null
    if (flags and Notification.FLAG_ONGOING_EVENT != 0) return null
    val extras = notification.notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text =
      (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
        ?.toString()
        .orEmpty()
    if (title.isBlank() && text.isBlank()) return null
    return KaviNotificationRecord(
      key = notification.key,
      packageName = notification.packageName,
      appName = appName(notification.packageName),
      title = title.take(KaviNotificationLog.MAX_TEXT_LENGTH),
      text = text.take(KaviNotificationLog.MAX_TEXT_LENGTH),
      postedAtMs = notification.postTime,
    )
  }

  private fun appName(packageName: String): String =
    try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
      packageName
    }

  internal companion object {
    private const val TAG = "KaviNotifications"

    /** The connected listener, to tell which logged notifications still show. */
    @Volatile
    var connected: KaviNotificationListenerService? = null
      private set
  }
}
