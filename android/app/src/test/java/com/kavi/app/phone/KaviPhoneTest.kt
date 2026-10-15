package com.kavi.mobile.phone

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowSmsManager
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KaviPhoneTest {
  private val application = ApplicationProvider.getApplicationContext<Application>()
  private val context: Context = application
  private lateinit var activity: Activity

  @Before
  fun setUp() {
    activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    shadowOf(application.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, true)
    shadowOf(application.packageManager)
      .setSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING, true)
    ShadowSmsManager.setDefaultSmsSubscriptionId(1)
  }

  private fun startedIntent(): Intent? = shadowOf(activity).nextStartedActivity

  @Test
  fun placesTheCallItselfWhenAllowed() {
    shadowOf(application).grantPermissions(Manifest.permission.CALL_PHONE)

    assertEquals(KaviCallOutcome.CALL_PLACED, KaviPhoneCalls.place(activity, context, "+15550102001"))
    val started = startedIntent()
    assertEquals(Intent.ACTION_CALL, started?.action)
    assertEquals("+15550102001", started?.data?.schemeSpecificPart)
  }

  @Test
  fun opensTheDialerWithoutTheCallPermission() {
    shadowOf(application).denyPermissions(Manifest.permission.CALL_PHONE)

    assertEquals(KaviCallOutcome.DIALER_OPENED, KaviPhoneCalls.place(activity, context, "+15550102001"))
    assertEquals(Intent.ACTION_DIAL, startedIntent()?.action)
  }

  @Test
  fun leavesEmergencyNumbersToTheDialer() {
    shadowOf(application).grantPermissions(Manifest.permission.CALL_PHONE)

    assertEquals(true, KaviPhoneCalls.isEmergencyNumber(context, "911"))
    assertEquals(KaviCallOutcome.DIALER_OPENED, KaviPhoneCalls.place(activity, context, "911"))
    assertEquals(Intent.ACTION_DIAL, startedIntent()?.action)
  }

  @Test
  fun startsNoCallWhileKaviIsNotOnScreen() {
    shadowOf(application).grantPermissions(Manifest.permission.CALL_PHONE)

    assertEquals(KaviCallOutcome.NOT_IN_FOREGROUND, KaviPhoneCalls.place(null, context, "+15550102001"))
  }

  @Test
  fun reportsADeviceThatCannotCall() {
    shadowOf(application.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, false)

    assertEquals(KaviCallOutcome.UNAVAILABLE, KaviPhoneCalls.place(activity, context, "+15550102001"))
    assertNull(startedIntent())
  }

  private fun postedCallNotification(): android.app.Notification? =
    shadowOf(context.getSystemService(android.app.NotificationManager::class.java))
      .allNotifications
      .singleOrNull()

  @Test
  fun postsATapToCallNotificationThatPlacesTheCall() {
    shadowOf(application).grantPermissions(Manifest.permission.CALL_PHONE)

    assertEquals(true, KaviPhoneCalls.postTapToCall(context, "+15550102001", "Call Ana", "Tap to call", "Calls"))

    val notification = postedCallNotification()!!
    assertEquals("Call Ana", notification.extras.getString(android.app.Notification.EXTRA_TITLE))
    val tap = shadowOf(notification.contentIntent).savedIntent
    assertEquals(Intent.ACTION_CALL, tap.action)
    assertEquals("+15550102001", tap.data?.schemeSpecificPart)
  }

  @Test
  fun tappingOpensTheDialerWithoutTheCallPermission() {
    shadowOf(application).denyPermissions(Manifest.permission.CALL_PHONE)

    KaviPhoneCalls.postTapToCall(context, "+15550102001", "Call Ana", "Tap to call", "Calls")

    assertEquals(Intent.ACTION_DIAL, shadowOf(postedCallNotification()!!.contentIntent).savedIntent.action)
  }

  @Test
  fun saysSoWhenKavisNotificationsAreOff() {
    shadowOf(context.getSystemService(android.app.NotificationManager::class.java))
      .setNotificationsEnabled(false)

    assertEquals(false, KaviPhoneCalls.postTapToCall(context, "+15550102001", "Call Ana", "Tap to call", "Calls"))
    assertNull(postedCallNotification())
  }

  private fun holdAssistantRole() {
    shadowOf(context.getSystemService(RoleManager::class.java)).addHeldRole(RoleManager.ROLE_ASSISTANT)
  }

  @Test
  fun sendsSmsOnlyAsTheDefaultAssistantWithItsPermission() {
    val sender = KaviSmsSender(context)
    assertEquals(KaviSmsAccess.ASSISTANT_ROLE_NEEDED, sender.access())

    holdAssistantRole()
    shadowOf(application).denyPermissions(Manifest.permission.SEND_SMS)
    assertEquals(KaviSmsAccess.PERMISSION_NEEDED, sender.access())

    shadowOf(application).grantPermissions(Manifest.permission.SEND_SMS)
    assertEquals(KaviSmsAccess.ALLOWED, sender.access())

    shadowOf(application.packageManager)
      .setSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING, false)
    assertEquals(KaviSmsAccess.UNAVAILABLE, sender.access())
  }

  /** The platform's split needs a live SMS service; one part per message is enough here. */
  private fun sender() = KaviSmsSender(context) { _, text -> arrayListOf(text) }

  /** Answers every pending SMS part the way the radio does: an ordered broadcast with a code. */
  private fun radioAnswers(resultCode: Int) {
    val sent = shadowOf(context.getSystemService(SmsManager::class.java)).lastSentMultipartTextMessageParams
    for (pendingIntent in sent.sentIntents) {
      context.sendOrderedBroadcast(
        shadowOf(pendingIntent).savedIntent,
        null,
        null,
        null,
        resultCode,
        null,
        null,
      )
    }
    ShadowLooper.idleMainLooper()
  }

  @Test
  fun reportsEachRecipientOnceTheRadioAnswers() {
    var results: List<KaviSmsResult>? = null

    sender().send(listOf("+15550102001"), "Running 10 minutes late") { results = it }
    val sent = shadowOf(context.getSystemService(SmsManager::class.java)).lastSentMultipartTextMessageParams
    assertEquals("+15550102001", sent.destinationAddress)
    assertEquals(listOf("Running 10 minutes late"), sent.parts)
    assertNull(results)

    radioAnswers(Activity.RESULT_OK)

    assertEquals(listOf(KaviSmsResult("+15550102001", "sent")), results)
  }

  @Test
  fun saysWhyTheRadioRefused() {
    var results: List<KaviSmsResult>? = null

    sender().send(listOf("+15550102001"), "Hi") { results = it }
    radioAnswers(SmsManager.RESULT_ERROR_NO_SERVICE)

    assertEquals(listOf(KaviSmsResult("+15550102001", "failed", "no_service")), results)
  }

  @Test
  fun reportsUnknownWhenTheRadioNeverAnswers() {
    var results: List<KaviSmsResult>? = null

    sender().send(listOf("+15550102001"), "Hi", timeoutMs = 5_000) { results = it }
    ShadowLooper.idleMainLooper(5_000, TimeUnit.MILLISECONDS)

    assertEquals(listOf(KaviSmsResult("+15550102001", "unknown")), results)
  }
}
