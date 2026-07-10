package com.kavi.mobile.durability

internal const val ANDROID_DURABLE_WORK_NAME_PREFIX = "kavi.durable-recovery.v1."
internal const val WORK_MANAGER_MIN_BACKOFF_MILLIS = 10_000L
internal const val WORK_MANAGER_MAX_BACKOFF_MILLIS = 18_000_000L

internal enum class AndroidTaskDurabilityClass {
  FOREGROUND_INTERACTIVE,
  USER_INITIATED_CONTINUABLE,
  DEFERRABLE_MAINTENANCE,
  EVENT_DRIVEN_MONITOR,
  EXTERNAL_DURABLE_OPERATION,
}

internal enum class AndroidRecoveryCommandKind {
  RESUME_MODEL_STEP,
  RESUME_PERSISTED_TOOL_BATCH,
  CONTINUE_AFTER_TOOL_RESULT,
  RECONCILE_EXTERNAL_HANDLES,
  RESUME_REVIEW,
  FINALIZE_EXISTING_TERMINAL_PROJECTION,
}

internal enum class AndroidNetworkConstraint {
  NOT_REQUIRED,
  CONNECTED,
  UNMETERED,
}

internal data class AndroidExecutionConstraints(
  val network: AndroidNetworkConstraint,
  val requiresCharging: Boolean,
  val requiresBatteryNotLow: Boolean,
  val requiresStorageNotLow: Boolean,
  val requiresDeviceIdle: Boolean,
  val earliestStartAtMillis: Long,
)

internal data class AndroidRetryPolicy(
  /** Includes the first execution attempt. */
  val maxAttempts: Int,
  val backoffPolicy: AndroidBackoffPolicy,
  val initialBackoffMillis: Long,
)

internal enum class AndroidBackoffPolicy {
  EXPONENTIAL,
}

/**
 * Stable identity of the journal generation and recovery command to wake.
 *
 * Authority and a single-use effect fence are deliberately not captured here: both must be
 * re-read and acquired immediately before dispatch after Android wakes the process.
 */
internal data class AndroidRecoveryCommandIdentity(
  val runId: String,
  val controlEpoch: Long,
  val snapshotUpdatedAtMillis: Long,
  val snapshotDigest: String,
  val commandKind: AndroidRecoveryCommandKind,
  val commandDigest: String,
)

internal data class AndroidDurableExecutionRequest(
  val durabilityClass: AndroidTaskDurabilityClass,
  val identity: AndroidRecoveryCommandIdentity,
  val constraints: AndroidExecutionConstraints,
  val retryPolicy: AndroidRetryPolicy,
  val requestedAtMillis: Long,
)

internal enum class AndroidDurableSchedulerKind {
  /** One finite, uniquely named WorkManager request. Never periodic or expedited. */
  WORK_MANAGER_ONE_TIME,
}

internal enum class AndroidDurableUnsupportedReason {
  INVALID_REQUEST,
  PROCESS_BOUND_INTERACTIVE_WORK,
  NO_GENERAL_AGENT_FOREGROUND_SERVICE_CONTRACT,
  MISSING_EVENT_TRIGGER_CONTRACT,
  MISSING_REQUIRED_NETWORK_CONSTRAINT,
  DEVICE_IDLE_BACKOFF_UNSUPPORTED,
  UNSAFE_RECOVERY_COMMAND,
}

internal sealed interface AndroidDurableExecutionDecision {
  data class Supported(
    val schedulerKind: AndroidDurableSchedulerKind,
    val uniqueWorkName: String,
    val requiresFreshRecoveryQuery: Boolean,
    val requiresFreshAuthorityAndFence: Boolean,
  ) : AndroidDurableExecutionDecision

  data class Unsupported(
    val reason: AndroidDurableUnsupportedReason,
  ) : AndroidDurableExecutionDecision
}
