package com.kavi.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.uimanager.ViewManager

/**
 * Lets a headless JS task tell native it finished. React Native 0.83 ships this contract as
 * an internal HeadlessJsTaskSupportModule that no package registers, so AppRegistry found no
 * `HeadlessJsTaskSupport` module and every headless task (scheduled runs, durable recovery)
 * held its WorkManager job until the task timeout, and was then counted as timed out.
 */
internal class KaviHeadlessJsTaskSupportModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun notifyTaskFinished(taskId: Double) {
    val taskContext = HeadlessJsTaskContext.getInstance(reactApplicationContext)
    val id = taskId.toInt()
    if (taskContext.isTaskRunning(id)) taskContext.finishTask(id)
  }

  @ReactMethod
  fun notifyTaskRetry(taskId: Double, promise: Promise) {
    val taskContext = HeadlessJsTaskContext.getInstance(reactApplicationContext)
    val id = taskId.toInt()
    promise.resolve(taskContext.isTaskRunning(id) && taskContext.retryTask(id))
  }

  companion object {
    const val NAME = "HeadlessJsTaskSupport"
  }
}

class KaviHeadlessJsTaskSupportPackage : ReactPackage {
  @Deprecated("ReactPackage#createNativeModules is deprecated upstream; legacy-package registration is still required here.")
  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(KaviHeadlessJsTaskSupportModule(reactContext))

  @Deprecated("ReactPackage#createViewManagers is deprecated upstream; this package has no views.")
  @Suppress("DEPRECATION")
  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
