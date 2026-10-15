package com.kavi.mobile.notifications

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KaviNotificationReplyTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()

  private fun broadcast(action: String, requestCode: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      requestCode,
      Intent(action).setPackage(context.packageName),
      PendingIntent.FLAG_MUTABLE,
    )

  private fun action(
    title: String,
    input: RemoteInput?,
    semantic: Int = Notification.Action.SEMANTIC_ACTION_NONE,
    requestCode: Int,
  ): Notification.Action =
    Notification.Action.Builder(null, title, broadcast("chat.$title", requestCode))
      .apply { input?.let(::addRemoteInput) }
      .setSemanticAction(semantic)
      .build()

  private fun notification(vararg actions: Notification.Action): Notification =
    Notification.Builder(context, "chat")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .apply { actions.forEach(::addAction) }
      .build()

  private val typed = RemoteInput.Builder("reply_text").setLabel("Reply").build()

  @Test
  fun findsTheReplyThatTakesTypedText() {
    val markRead = action("Mark as read", input = null, requestCode = 1)
    val choices =
      action(
        "Quick reply",
        RemoteInput.Builder("choice").setChoices(arrayOf("OK")).setAllowFreeFormInput(false).build(),
        requestCode = 2,
      )
    val reply = action("Reply", typed, Notification.Action.SEMANTIC_ACTION_REPLY, requestCode = 3)

    val found = KaviNotificationReply.find(notification(markRead, choices, reply))

    assertEquals("Reply", found?.action?.title)
    assertEquals("reply_text", found?.input?.resultKey)
  }

  @Test
  fun prefersTheActionTheAppMarkedAsItsReply() {
    val other = action("Comment", RemoteInput.Builder("comment").build(), requestCode = 4)
    val reply = action("Reply", typed, Notification.Action.SEMANTIC_ACTION_REPLY, requestCode = 5)

    assertEquals("Reply", KaviNotificationReply.find(notification(other, reply))?.action?.title)
  }

  @Test
  fun findsAReplyOfferedOnlyToWatches() {
    val reply = action("Reply", typed, requestCode = 6)
    val withWatchReply =
      Notification.Builder(context, "chat")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .extend(@Suppress("DEPRECATION") Notification.WearableExtender().addAction(reply))
        .build()

    assertEquals("Reply", KaviNotificationReply.find(withWatchReply)?.action?.title)
  }

  @Test
  fun findsNothingWithoutAnActionThatTakesText() {
    assertNull(KaviNotificationReply.find(notification(action("Open", null, requestCode = 7))))
  }

  @Test
  fun sendsTheTextThroughTheAppsReplyIntent() {
    val reply = KaviNotificationReply.find(notification(action("Reply", typed, requestCode = 8)))!!

    val outcome = KaviNotificationReply.send(context, reply, "Yes, Friday works")

    assertEquals(KaviReplyOutcome.SENT, outcome)
    val fired = shadowOf(context as android.app.Application).broadcastIntents.last()
    assertEquals("chat.Reply", fired.action)
    assertEquals(
      "Yes, Friday works",
      RemoteInput.getResultsFromIntent(fired)?.getCharSequence("reply_text")?.toString(),
    )
    assertEquals(RemoteInput.SOURCE_FREE_FORM_INPUT, RemoteInput.getResultsSource(fired))
  }

  @Test
  fun reportsAReplyWhoseIntentTheAppWithdrew() {
    val replyAction = action("Reply", typed, requestCode = 9)
    val reply = KaviNotificationReply.find(notification(replyAction))!!
    replyAction.actionIntent.cancel()

    assertEquals(KaviReplyOutcome.EXPIRED, KaviNotificationReply.send(context, reply, "Hi"))
  }
}
