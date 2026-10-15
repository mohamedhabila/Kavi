package com.kavi.mobile.notifications

import android.app.Notification
import android.os.Process
import android.service.notification.StatusBarNotification
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KaviNotificationListenerTest {
  private fun record(key: String, postedAtMs: Long) =
    KaviNotificationRecord(key, "com.example.chat", "Chat", "Ana", "See you at 7", postedAtMs)

  @Test
  fun logKeepsTheNewestRecordsWithinItsCapacity() {
    val log = KaviNotificationLog(capacity = 3)
    for (index in 1..5) log.add(record("k$index", index * 1_000L))

    assertEquals(listOf("k5", "k4", "k3"), log.recent(sinceMs = 0, limit = 10).map { it.key })
    assertEquals(listOf("k5"), log.recent(sinceMs = 0, limit = 1).map { it.key })
    assertEquals(listOf("k5", "k4"), log.recent(sinceMs = 4_000, limit = 10).map { it.key })
  }

  @Test
  fun logReplacesAnUpdatedNotificationAndMovesItToTheNewest() {
    val log = KaviNotificationLog()
    log.add(record("thread", 1_000))
    log.add(record("other", 2_000))
    log.add(record("thread", 3_000).copy(text = "Running late"))

    val recent = log.recent(sinceMs = 0, limit = 10)
    assertEquals(listOf("thread", "other"), recent.map { it.key })
    assertEquals("Running late", recent.first().text)
  }

  private fun posted(
    packageName: String,
    tag: String,
    flags: Int = 0,
    title: String? = "Ana",
    text: String? = "See you at 7",
    bigText: String? = null,
  ): StatusBarNotification {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val notification =
      Notification.Builder(context, "chat").setSmallIcon(android.R.drawable.ic_dialog_info).build()
    title?.let { notification.extras.putCharSequence(Notification.EXTRA_TITLE, it) }
    text?.let { notification.extras.putCharSequence(Notification.EXTRA_TEXT, it) }
    bigText?.let { notification.extras.putCharSequence(Notification.EXTRA_BIG_TEXT, it) }
    notification.flags = notification.flags or flags
    @Suppress("DEPRECATION")
    return StatusBarNotification(
      packageName,
      packageName,
      1,
      tag,
      Process.myUid(),
      0,
      0,
      notification,
      Process.myUserHandle(),
      42_000L,
    )
  }

  @Test
  fun listenerKeepsOtherAppsMessagesAndSkipsItsOwnOngoingAndSummaries() {
    val service = Robolectric.setupService(KaviNotificationListenerService::class.java)
    val before = KaviNotificationLog.shared.recent(sinceMs = 0, limit = 200).size

    service.onNotificationPosted(posted("com.example.chat", "message", bigText = "See you at 7, table by the window"))
    service.onNotificationPosted(posted(service.packageName, "own"))
    service.onNotificationPosted(posted("com.example.music", "player", flags = Notification.FLAG_ONGOING_EVENT))
    service.onNotificationPosted(posted("com.example.chat", "summary", flags = Notification.FLAG_GROUP_SUMMARY))
    service.onNotificationPosted(posted("com.example.chat", "empty", title = null, text = null))
    service.onNotificationPosted(posted("com.example.mail", "long", text = "x".repeat(5_000)))

    val recent = KaviNotificationLog.shared.recent(sinceMs = 0, limit = 200)
    assertEquals(before + 2, recent.size)
    val message = recent.first { it.packageName == "com.example.chat" }
    assertEquals("Ana", message.title)
    assertEquals("See you at 7, table by the window", message.text)
    assertEquals(42_000L, message.postedAtMs)
    assertTrue(recent.first().text.length == KaviNotificationLog.MAX_TEXT_LENGTH)
  }
}
