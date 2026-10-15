package com.kavi.mobile.phone

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.LifecycleState

internal const val KAVI_PHONE_MODULE_NAME = "KaviPhone"

/** Calls and SMS Kavi places for the person, after they approve each one. */
internal class KaviPhoneModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val sms = KaviSmsSender(reactContext)

  override fun getName(): String = KAVI_PHONE_MODULE_NAME

  /**
   * "call_placed", "dialer_opened", "not_in_foreground" or "unavailable". On screen means
   * resumed: React Native keeps the last activity after it stops, and Android silently drops
   * a call started from the background.
   */
  @ReactMethod
  fun placeCall(number: String, promise: Promise) {
    val onScreen = reactApplicationContext.lifecycleState == LifecycleState.RESUMED
    val activity = if (onScreen) reactApplicationContext.currentActivity else null
    promise.resolve(KaviPhoneCalls.place(activity, reactApplicationContext, number).wire)
  }

  /** Posts a notification that places the call when tapped; false if notifications are off. */
  @ReactMethod
  fun postTapToCall(number: String, title: String, body: String, channelName: String, promise: Promise) {
    promise.resolve(KaviPhoneCalls.postTapToCall(reactApplicationContext, number, title, body, channelName))
  }

  /** "allowed", "assistant_role_needed", "permission_needed" or "unavailable". */
  @ReactMethod
  fun getSmsAccess(promise: Promise) {
    promise.resolve(sms.access().wire)
  }

  /**
   * Sends [text] to each recipient (E.164 numbers) once Kavi may send SMS, and resolves with
   * each recipient's result; `access` says why nothing was sent otherwise.
   */
  @ReactMethod
  fun sendSms(recipients: ReadableArray, text: String, promise: Promise) {
    val access = sms.access()
    if (access != KaviSmsAccess.ALLOWED) {
      promise.resolve(Arguments.createMap().apply { putString("access", access.wire) })
      return
    }
    val numbers = (0 until recipients.size()).mapNotNull { recipients.getString(it) }
    sms.send(numbers, text) { results ->
      promise.resolve(
        Arguments.createMap().apply {
          putString("access", access.wire)
          putArray(
            "results",
            Arguments.createArray().apply {
              results.forEach { result ->
                pushMap(
                  Arguments.createMap().apply {
                    putString("recipient", result.recipient)
                    putString("status", result.status)
                    result.error?.let { putString("error", it) }
                  },
                )
              }
            },
          )
        },
      )
    }
  }
}
