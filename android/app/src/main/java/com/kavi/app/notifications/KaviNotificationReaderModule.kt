package com.kavi.mobile.notifications

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

internal const val KAVI_NOTIFICATION_READER_MODULE_NAME = "KaviNotificationReader"

/**
 * Lets Kavi read back the notifications other apps showed, after the person turns on
 * notification access for Kavi (a special access apps cannot request in a dialog).
 */
internal class KaviNotificationReaderModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = KAVI_NOTIFICATION_READER_MODULE_NAME

  private fun hasAccess(): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(reactApplicationContext)
      .contains(reactApplicationContext.packageName)

  /** "granted" or "not_granted". */
  @ReactMethod
  fun getAccessState(promise: Promise) {
    promise.resolve(if (hasAccess()) ACCESS_GRANTED else ACCESS_NOT_GRANTED)
  }

  /** Opens the system page where the person turns notification access on; false if none opens. */
  @ReactMethod
  fun openAccessSettings(promise: Promise) {
    val intents =
      buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          add(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
              Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
              ComponentName(reactApplicationContext, KaviNotificationListenerService::class.java)
                .flattenToString(),
            ),
          )
        }
        add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
      }
    for (intent in intents) {
      try {
        reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(true)
        return
      } catch (_: ActivityNotFoundException) {
        continue
      }
    }
    promise.resolve(false)
  }

  /**
   * The notifications posted since [sinceMs], newest first, at most [limit], each marked
   * whether it still shows. Without access the list is empty and `access` says why.
   */
  @ReactMethod
  fun readRecent(sinceMs: Double, limit: Int, promise: Promise) {
    val result = Arguments.createMap()
    val notifications = Arguments.createArray()
    if (!hasAccess()) {
      result.putString("access", ACCESS_NOT_GRANTED)
      result.putArray("notifications", notifications)
      promise.resolve(result)
      return
    }
    val showing = showingKeys()
    for (record in KaviNotificationLog.shared.recent(sinceMs.toLong(), limit.coerceIn(1, MAX_LIMIT))) {
      notifications.pushMap(
        Arguments.createMap().apply {
          putString("app", record.appName)
          putString("packageName", record.packageName)
          putString("title", record.title)
          putString("text", record.text)
          putDouble("postedAt", record.postedAtMs.toDouble())
          putBoolean("showing", showing?.contains(record.key) ?: false)
        },
      )
    }
    result.putString("access", ACCESS_GRANTED)
    result.putBoolean("listening", KaviNotificationListenerService.connected != null)
    result.putArray("notifications", notifications)
    promise.resolve(result)
  }

  private fun showingKeys(): Set<String>? =
    try {
      KaviNotificationListenerService.connected?.activeNotifications?.mapTo(HashSet()) { it.key }
    } catch (error: SecurityException) {
      Log.w("KaviNotifications", "Could not read which notifications still show.", error)
      null
    }

  private companion object {
    const val ACCESS_GRANTED = "granted"
    const val ACCESS_NOT_GRANTED = "not_granted"
    const val MAX_LIMIT = 100
  }
}
