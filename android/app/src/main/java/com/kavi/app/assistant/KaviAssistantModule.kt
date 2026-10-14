package com.kavi.mobile.assistant

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

internal const val KAVI_ASSISTANT_MODULE_NAME = "KaviAssistant"

/**
 * Whether Kavi is the phone's default digital assistant, and the way to make it one. The
 * assistant role is not requestable by apps (AOSP roles.xml: requestable="false"), so the person
 * picks Kavi in the system's assistant settings.
 */
internal class KaviAssistantModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = KAVI_ASSISTANT_MODULE_NAME

  /** "held", "not_held", or "unavailable" when this Android has no assistant role to hold. */
  @ReactMethod
  fun getAssistantRoleState(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve(ROLE_UNAVAILABLE)
      return
    }
    val roleManager = reactApplicationContext.getSystemService(RoleManager::class.java)
    promise.resolve(
      when {
        roleManager == null || !roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT) ->
          ROLE_UNAVAILABLE
        roleManager.isRoleHeld(RoleManager.ROLE_ASSISTANT) -> ROLE_HELD
        else -> ROLE_NOT_HELD
      },
    )
  }

  /** Opens the system's digital assistant settings; resolves false when none can be opened. */
  @ReactMethod
  fun openAssistantSettings(promise: Promise) {
    for (action in listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) {
      try {
        reactApplicationContext.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(true)
        return
      } catch (_: ActivityNotFoundException) {
        continue
      }
    }
    promise.resolve(false)
  }

  private companion object {
    const val ROLE_HELD = "held"
    const val ROLE_NOT_HELD = "not_held"
    const val ROLE_UNAVAILABLE = "unavailable"
  }
}
