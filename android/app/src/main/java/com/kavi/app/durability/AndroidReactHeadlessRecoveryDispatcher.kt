package com.kavi.mobile.durability

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

internal const val ANDROID_DURABLE_HEADLESS_TASK_KEY = "KaviDurableRecovery"
internal const val ANDROID_DURABLE_HEADLESS_PAYLOAD_SCHEMA = 1

/** Starts the existing ReactHost directly; WorkManager already owns wake and process lifetime. */
internal class AndroidReactHeadlessRecoveryDispatcher(
  context: Context,
) : AndroidDurableHeadlessDispatcher {
  private val application = context.applicationContext as? ReactApplication

  override suspend fun dispatch(
    payload: AndroidDurableHeadlessPayload,
  ): AndroidDurableHeadlessDispatchResult {
    val reactApplication = application ?: return AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    val reactHost = reactApplication.reactHost
      ?: return AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    val started = withContext(Dispatchers.IO) {
      val startTask = reactHost.start()
      val completed = startTask.waitForCompletion(REACT_START_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      completed && !startTask.isCancelled() && !startTask.isFaulted()
    }
    if (!started) return AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    val reactContext = reactHost.currentReactContext
      ?: return AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
    val expectedTaskId = AtomicInteger(NO_TASK_ID)
    val earlyFinishes = ConcurrentHashMap.newKeySet<Int>()
    val finished = CompletableDeferred<Unit>()
    val listener = object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(taskId: Int) = Unit

      override fun onHeadlessJsTaskFinish(taskId: Int) {
        if (taskId == expectedTaskId.get()) {
          finished.complete(Unit)
        } else {
          earlyFinishes += taskId
        }
      }
    }

    return try {
      withContext(Dispatchers.Main.immediate) {
        taskContext.addTaskEventListener(listener)
        val taskId = taskContext.startTask(taskConfig(payload))
        expectedTaskId.set(taskId)
        if (earlyFinishes.remove(taskId)) {
          finished.complete(Unit)
        }
      }
      if (withTimeoutOrNull(HEADLESS_AWAIT_TIMEOUT_MILLIS) { finished.await() } != null) {
        AndroidDurableHeadlessDispatchResult.FINISHED
      } else {
        AndroidDurableHeadlessDispatchResult.TIMED_OUT
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    } finally {
      withContext(NonCancellable + Dispatchers.Main.immediate) {
        taskContext.removeTaskEventListener(listener)
      }
    }
  }

  private fun taskConfig(payload: AndroidDurableHeadlessPayload): HeadlessJsTaskConfig {
    val identity = payload.work.identity
    val data = Arguments.createMap().apply {
      putInt("schema", ANDROID_DURABLE_HEADLESS_PAYLOAD_SCHEMA)
      putString("workId", payload.work.platformWorkId)
      putString("runId", identity.runId)
      putDouble("controlEpoch", identity.controlEpoch.toDouble())
      putDouble("snapshotUpdatedAtMillis", identity.snapshotUpdatedAtMillis.toDouble())
      putString("snapshotDigest", identity.snapshotDigest)
      putString("commandKind", identity.commandKind.name.lowercase())
      putString("commandDigest", identity.commandDigest)
      putInt("attempt", payload.attempt)
    }
    return HeadlessJsTaskConfig(
      ANDROID_DURABLE_HEADLESS_TASK_KEY,
      data,
      HEADLESS_TASK_TIMEOUT_MILLIS,
      true,
    )
  }

  private companion object {
    const val NO_TASK_ID = -1
    const val REACT_START_TIMEOUT_SECONDS = 60L
    const val HEADLESS_TASK_TIMEOUT_MILLIS = 8 * 60 * 1_000L
    const val HEADLESS_AWAIT_TIMEOUT_MILLIS = HEADLESS_TASK_TIMEOUT_MILLIS + 5_000L
  }
}
