package com.kavi.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.kavi.mobile.longhorizon.AndroidLongHorizonExecutionRuntime

import expo.modules.ReactActivityDelegateWrapper

private const val ASSIST_LAUNCH_URL = "kavi://assist"

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    routeAssistIntent(intent)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    routeAssistIntent(intent)
    super.onNewIntent(intent)
  }

  /**
   * The system opens the default digital assistant (long-press home or power, a headset's voice
   * button) with ACTION_ASSIST or ACTION_VOICE_COMMAND, which carry no URI. React Native's Linking
   * only reports VIEW intents, so the assist request becomes the `kavi://assist` link the app
   * routes to voice.
   */
  private fun routeAssistIntent(intent: Intent?) {
    if (intent?.action == Intent.ACTION_ASSIST || intent?.action == Intent.ACTION_VOICE_COMMAND) {
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse(ASSIST_LAUNCH_URL)
    }
  }

  override fun onResume() {
    super.onResume()
    AndroidLongHorizonExecutionRuntime.get(this).coordinator.onHostForegrounded()
  }

  override fun onPause() {
    // Acquire the user-visible execution owner while this activity is still eligible to start a
    // foreground service. Once acquired, it remains alive until the last task lease is released;
    // stopping and reacquiring it on every foreground transition creates an Android timing race.
    AndroidLongHorizonExecutionRuntime.get(this).coordinator.onHostBackgrounded()
    super.onPause()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
