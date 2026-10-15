package com.kavi.mobile.phone

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.app.role.RoleManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Whether Kavi may send SMS itself, as the JS side reads it. */
internal enum class KaviSmsAccess(val wire: String) {
  /** Kavi is the default assistant and holds the SMS permission the role grants. */
  ALLOWED("allowed"),
  /** Google Play allows direct SMS only for the default assistant; Kavi is not it. */
  ASSISTANT_ROLE_NEEDED("assistant_role_needed"),
  /** The role is held but its SMS permission is not granted (or was revoked). */
  PERMISSION_NEEDED("permission_needed"),
  /** This device cannot send SMS. */
  UNAVAILABLE("unavailable"),
}

/** One recipient's result: "sent", "failed" with the radio's reason, or "unknown" on timeout. */
internal data class KaviSmsResult(val recipient: String, val status: String, val error: String? = null)

/**
 * Sends SMS for the person through the phone's own SMS service. Allowed only while Kavi is
 * the default digital assistant (Google Play's "Default Assistant handler" use; the role
 * grants the permission), checked again on every send.
 */
internal class KaviSmsSender(
  private val context: Context,
  /** Splits a message into the parts the radio sends; the platform's own split by default. */
  private val divide: (SmsManager, String) -> ArrayList<String> = { manager, text ->
    manager.divideMessage(text)
  },
) {
  fun access(): KaviSmsAccess {
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING)) {
      return KaviSmsAccess.UNAVAILABLE
    }
    if (!isAssistant()) return KaviSmsAccess.ASSISTANT_ROLE_NEEDED
    val granted =
      ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) ==
        PackageManager.PERMISSION_GRANTED
    return if (granted) KaviSmsAccess.ALLOWED else KaviSmsAccess.PERMISSION_NEEDED
  }

  /**
   * Sends [text] to each of [recipients] and reports each one once the radio answers for
   * every part, or after [timeoutMs] with "unknown" for those still unanswered.
   */
  fun send(
    recipients: List<String>,
    text: String,
    timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    onDone: (List<KaviSmsResult>) -> Unit,
  ) {
    val manager = smsManager()
    val parts = divide(manager, text)
    val pending = recipients.associateWith { parts.size }.toMutableMap()
    val results = linkedMapOf<String, KaviSmsResult>()
    val action = "${context.packageName}.SMS_SENT.${UUID.randomUUID()}"
    val finished = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    lateinit var receiver: BroadcastReceiver

    fun finish() {
      if (!finished.compareAndSet(false, true)) return
      handler.removeCallbacksAndMessages(null)
      try {
        context.unregisterReceiver(receiver)
      } catch (_: IllegalArgumentException) {
        // Already unregistered.
      }
      onDone(recipients.map { results[it] ?: KaviSmsResult(it, "unknown") })
    }

    receiver =
      object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context, intent: Intent) {
          val recipient = intent.getStringExtra(EXTRA_RECIPIENT) ?: return
          synchronized(results) {
            if (resultCode != Activity.RESULT_OK && results[recipient]?.status != "failed") {
              results[recipient] = KaviSmsResult(recipient, "failed", radioError(resultCode))
            }
            val remaining = (pending[recipient] ?: 0) - 1
            pending[recipient] = remaining
            if (remaining == 0 && results[recipient] == null) {
              results[recipient] = KaviSmsResult(recipient, "sent")
            }
            if (pending.values.all { it <= 0 }) finish()
          }
        }
      }
    ContextCompat.registerReceiver(
      context,
      receiver,
      IntentFilter(action),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    handler.postDelayed({ finish() }, timeoutMs)

    for ((index, recipient) in recipients.withIndex()) {
      val sentIntents =
        ArrayList(
          parts.indices.map { part ->
            PendingIntent.getBroadcast(
              context,
              index * MAX_PARTS + part,
              Intent(action).setPackage(context.packageName).putExtra(EXTRA_RECIPIENT, recipient),
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
            )
          },
        )
      try {
        manager.sendMultipartTextMessage(recipient, null, parts, sentIntents, null)
      } catch (error: RuntimeException) {
        synchronized(results) {
          results[recipient] = KaviSmsResult(recipient, "failed", error.javaClass.simpleName)
          pending[recipient] = 0
          if (pending.values.all { it <= 0 }) finish()
        }
      }
    }
  }

  private fun isAssistant(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true

  private fun smsManager(): SmsManager =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      context.getSystemService(SmsManager::class.java)
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }

  private fun radioError(code: Int): String =
    when (code) {
      SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
      SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
      SmsManager.RESULT_ERROR_NULL_PDU -> "null_pdu"
      SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "limit_exceeded"
      SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED,
      SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "short_code_not_allowed"
      else -> "generic_failure"
    }

  private companion object {
    const val EXTRA_RECIPIENT = "recipient"
    const val DEFAULT_TIMEOUT_MS = 60_000L
    /** Request codes are recipient * MAX_PARTS + part, so no two pending intents collide. */
    const val MAX_PARTS = 64
  }
}
