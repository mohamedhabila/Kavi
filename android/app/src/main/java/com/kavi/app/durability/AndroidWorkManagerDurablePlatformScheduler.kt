package com.kavi.mobile.durability

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.util.UUID
import java.util.concurrent.TimeUnit

internal const val ANDROID_DURABLE_WORK_TAG = "kavi.durable-recovery.v1"

/** Exact-identity WorkManager implementation for one finite recovery command. */
internal class AndroidWorkManagerDurablePlatformScheduler(
  context: Context,
  private val workManager: WorkManager = WorkManager.getInstance(context.applicationContext),
  private val clock: () -> Long = System::currentTimeMillis,
) : AndroidDurablePlatformScheduler {
  override fun allocateWorkId(): String = UUID.randomUUID().toString()

  override fun enqueue(spec: AndroidDurableWorkSpec): AndroidDurableScheduleResult {
    if (spec.schedulerKind != AndroidDurableSchedulerKind.WORK_MANAGER_ONE_TIME) {
      return AndroidDurableScheduleResult.CONFLICT
    }
    val workId = parseWorkId(spec.platformWorkId) ?: return AndroidDurableScheduleResult.CONFLICT
    return try {
      val existing = workManager.getWorkInfoById(workId).get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      if (existing != null) {
        return classifyExisting(existing, spec)
      }
      val conflicting = workManager
        .getWorkInfosForUniqueWork(spec.uniqueWorkName)
        .get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .any { !it.state.isFinished && it.id != workId }
      if (conflicting) {
        return AndroidDurableScheduleResult.CONFLICT
      }

      val request = buildWorkRequest(spec, clock())
      val candidateWake = buildCandidateWakeRequest(spec)
      workManager
        .beginUniqueWork(spec.uniqueWorkName, ExistingWorkPolicy.KEEP, request)
        .then(candidateWake)
        .enqueue()
        .result
        .get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      val enqueued = workManager
        .getWorkInfoById(workId)
        .get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        ?: return AndroidDurableScheduleResult.UNAVAILABLE
      classifyExisting(enqueued, spec)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      AndroidDurableScheduleResult.UNAVAILABLE
    } catch (_: Exception) {
      AndroidDurableScheduleResult.UNAVAILABLE
    }
  }

  override fun cancel(platformWorkId: String): AndroidDurableCancellationResult {
    val workId = parseWorkId(platformWorkId) ?: return AndroidDurableCancellationResult.UNAVAILABLE
    return try {
      val existing = workManager
        .getWorkInfoById(workId)
        .get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        ?: return AndroidDurableCancellationResult.MISSING
      if (existing.state.isFinished) {
        return AndroidDurableCancellationResult.TERMINAL
      }
      workManager.cancelWorkById(workId).result.get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      val cancelled = workManager
        .getWorkInfoById(workId)
        .get(PLATFORM_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        ?: return AndroidDurableCancellationResult.MISSING
      if (cancelled.state.isFinished) {
        AndroidDurableCancellationResult.TERMINAL
      } else {
        AndroidDurableCancellationResult.ACCEPTED
      }
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      AndroidDurableCancellationResult.UNAVAILABLE
    } catch (_: Exception) {
      AndroidDurableCancellationResult.UNAVAILABLE
    }
  }

  internal fun buildWorkRequest(spec: AndroidDurableWorkSpec, nowMillis: Long): OneTimeWorkRequest {
    val request = spec.request
    val identity = request.identity
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(request.constraints.network.toWorkManagerNetworkType())
      .setRequiresCharging(request.constraints.requiresCharging)
      .setRequiresBatteryNotLow(request.constraints.requiresBatteryNotLow)
      .setRequiresStorageNotLow(request.constraints.requiresStorageNotLow)
      .build()
    val input = Data.Builder()
      .putInt(ANDROID_DURABLE_WORK_INPUT_SCHEMA_KEY, ANDROID_DURABLE_WORK_INPUT_SCHEMA)
      .putString(ANDROID_DURABLE_WORK_INPUT_ID_KEY, spec.platformWorkId)
      .putString(ANDROID_DURABLE_WORK_INPUT_RUN_ID_KEY, identity.runId)
      .putLong(ANDROID_DURABLE_WORK_INPUT_CONTROL_EPOCH_KEY, identity.controlEpoch)
      .putLong(
        ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_UPDATED_AT_KEY,
        identity.snapshotUpdatedAtMillis,
      )
      .putString(ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY, identity.snapshotDigest)
      .putString(ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY, identity.commandKind.name)
      .putString(ANDROID_DURABLE_WORK_INPUT_COMMAND_DIGEST_KEY, identity.commandDigest)
      .build()
    val initialDelayMillis = (request.constraints.earliestStartAtMillis - nowMillis).coerceAtLeast(0)

    return OneTimeWorkRequestBuilder<AndroidDurableExecutionWorker>()
      .setId(checkNotNull(parseWorkId(spec.platformWorkId)))
      .setInputData(input)
      .setConstraints(constraints)
      .setInitialDelay(initialDelayMillis, TimeUnit.MILLISECONDS)
      .setBackoffCriteria(
        BackoffPolicy.EXPONENTIAL,
        request.retryPolicy.initialBackoffMillis,
        TimeUnit.MILLISECONDS,
      )
      .addTag(ANDROID_DURABLE_WORK_TAG)
      .addTag(spec.uniqueWorkName)
      .build()
  }

  internal fun buildCandidateWakeRequest(spec: AndroidDurableWorkSpec): OneTimeWorkRequest {
    val wakeWorkId = UUID.randomUUID()
    val input = Data.Builder()
      .putInt(
        ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA_KEY,
        ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA,
      )
      .putString(ANDROID_DURABLE_CANDIDATE_INPUT_WAKE_ID_KEY, wakeWorkId.toString())
      .putString(
        ANDROID_DURABLE_CANDIDATE_INPUT_PREDECESSOR_ID_KEY,
        spec.platformWorkId,
      )
      .putString(ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY, spec.request.identity.runId)
      .build()
    return OneTimeWorkRequestBuilder<AndroidDurableCandidateWakeWorker>()
      .setId(wakeWorkId)
      .setInputData(input)
      .setBackoffCriteria(
        BackoffPolicy.EXPONENTIAL,
        CANDIDATE_INITIAL_BACKOFF_MILLIS,
        TimeUnit.MILLISECONDS,
      )
      .addTag(ANDROID_DURABLE_CANDIDATE_WORK_TAG)
      .addTag(spec.uniqueWorkName)
      .build()
  }

  private fun classifyExisting(
    info: WorkInfo,
    spec: AndroidDurableWorkSpec,
  ): AndroidDurableScheduleResult {
    if (
      info.id.toString() != spec.platformWorkId ||
      ANDROID_DURABLE_WORK_TAG !in info.tags ||
      spec.uniqueWorkName !in info.tags
    ) {
      return AndroidDurableScheduleResult.CONFLICT
    }
    return if (info.state.isFinished) {
      AndroidDurableScheduleResult.TERMINAL
    } else {
      AndroidDurableScheduleResult.ACCEPTED
    }
  }

  private fun AndroidNetworkConstraint.toWorkManagerNetworkType(): NetworkType = when (this) {
    AndroidNetworkConstraint.NOT_REQUIRED -> NetworkType.NOT_REQUIRED
    AndroidNetworkConstraint.CONNECTED -> NetworkType.CONNECTED
    AndroidNetworkConstraint.UNMETERED -> NetworkType.UNMETERED
  }

  private fun parseWorkId(value: String): UUID? = try {
    UUID.fromString(value).takeIf { it.toString() == value }
  } catch (_: IllegalArgumentException) {
    null
  }

  private companion object {
    const val PLATFORM_TIMEOUT_SECONDS = 10L
    const val CANDIDATE_INITIAL_BACKOFF_MILLIS = 30_000L
  }
}
