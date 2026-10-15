package com.kavi.mobile.notifications

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle

/** How a reply the person approved went, as the JS side reads it. */
internal enum class KaviReplyOutcome(val wire: String) {
  SENT("sent"),
  NOT_SHOWING("not_showing"),
  NO_REPLY_ACTION("no_reply_action"),
  EXPIRED("expired"),
}

/** A notification's reply: the action to fire and the free-form input that carries the text. */
internal class KaviReplyAction(val action: Notification.Action, val input: RemoteInput)

/**
 * Replies the way the person would from the notification shade: through the posting app's own
 * reply action (WhatsApp, Telegram, Signal, Messages, …). Which apps offer one is decided by
 * each app, so it is read from the live notification rather than assumed.
 */
internal object KaviNotificationReply {
  /** The action that takes typed text, preferring the one the app marked as its reply. */
  fun find(notification: Notification): KaviReplyAction? {
    val replies =
      candidateActions(notification).mapNotNull { action ->
        action.remoteInputs?.firstOrNull { it.allowFreeFormInput }?.let { KaviReplyAction(action, it) }
      }
    return replies.firstOrNull(::isMarkedReply) ?: replies.firstOrNull()
  }

  /** Fills the reply text into the app's reply intent and fires it. */
  fun send(context: Context, reply: KaviReplyAction, text: String): KaviReplyOutcome {
    val intent = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
    val results = Bundle().apply { putCharSequence(reply.input.resultKey, text) }
    RemoteInput.addResultsToIntent(reply.action.remoteInputs, intent, results)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT)
    }
    return try {
      reply.action.actionIntent.send(context, 0, intent)
      KaviReplyOutcome.SENT
    } catch (_: PendingIntent.CanceledException) {
      KaviReplyOutcome.EXPIRED
    }
  }

  /** Some messaging apps put the reply only among the actions they offer to watches. */
  private fun candidateActions(notification: Notification): List<Notification.Action> =
    notification.actions.orEmpty().toList() +
      @Suppress("DEPRECATION")
      Notification.WearableExtender(notification).actions

  private fun isMarkedReply(reply: KaviReplyAction): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      reply.action.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY
}
