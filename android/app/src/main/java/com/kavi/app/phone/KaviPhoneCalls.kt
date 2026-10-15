package com.kavi.mobile.phone

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.kavi.mobile.R

/** How a call the person approved went, as the JS side reads it. */
internal enum class KaviCallOutcome(val wire: String) {
  /** The phone is dialing. */
  CALL_PLACED("call_placed"),
  /** Emergency numbers, or no call permission: the dialer is open with the number. */
  DIALER_OPENED("dialer_opened"),
  /** Kavi is not on screen, so Android would not let it start a call. */
  NOT_IN_FOREGROUND("not_in_foreground"),
  /** This device cannot place calls. */
  UNAVAILABLE("unavailable"),
}

/**
 * Places calls for the person. A call needs Kavi on screen (Android blocks starting one from
 * the background) and the call permission; emergency numbers always go to the dialer, which
 * is the only app allowed to call them.
 */
internal object KaviPhoneCalls {
  private const val CHANNEL_ID = "kavi_calls"
  private const val NOTIFICATION_TAG = "kavi_call"

  fun canPlaceCalls(context: Context): Boolean =
    context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)

  fun hasCallPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) ==
      PackageManager.PERMISSION_GRANTED

  fun isEmergencyNumber(context: Context, number: String): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      try {
        context.getSystemService(TelephonyManager::class.java)?.isEmergencyNumber(number) == true
      } catch (_: IllegalStateException) {
        false
      } catch (_: UnsupportedOperationException) {
        false
      }
    } else {
      @Suppress("DEPRECATION")
      PhoneNumberUtils.isEmergencyNumber(number)
    }

  fun place(activity: Activity?, context: Context, number: String): KaviCallOutcome {
    if (!canPlaceCalls(context)) return KaviCallOutcome.UNAVAILABLE
    if (activity == null) return KaviCallOutcome.NOT_IN_FOREGROUND
    val direct = hasCallPermission(context) && !isEmergencyNumber(context, number)
    if (!direct) return openDialer(activity, number)
    return try {
      activity.startActivity(callIntent(number, direct = true))
      KaviCallOutcome.CALL_PLACED
    } catch (_: SecurityException) {
      openDialer(activity, number)
    } catch (_: ActivityNotFoundException) {
      openDialer(activity, number)
    }
  }

  private fun openDialer(activity: Activity, number: String): KaviCallOutcome =
    try {
      activity.startActivity(callIntent(number, direct = false))
      KaviCallOutcome.DIALER_OPENED
    } catch (_: ActivityNotFoundException) {
      KaviCallOutcome.UNAVAILABLE
    }

  /**
   * For a call asked for while Kavi is not on screen: a notification that places the call
   * when tapped. False when the person turned Kavi's notifications off.
   */
  fun postTapToCall(
    context: Context,
    number: String,
    title: String,
    body: String,
    channelName: String,
  ): Boolean {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_HIGH),
      )
    }
    val direct = hasCallPermission(context) && !isEmergencyNumber(context, number)
    val tap =
      PendingIntent.getActivity(
        context,
        number.hashCode(),
        callIntent(number, direct),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val notification =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setContentIntent(tap)
        .setAutoCancel(true)
        .build()
    return try {
      manager.notify(NOTIFICATION_TAG, number.hashCode(), notification)
      true
    } catch (_: SecurityException) {
      false
    }
  }

  private fun callIntent(number: String, direct: Boolean): Intent =
    Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
