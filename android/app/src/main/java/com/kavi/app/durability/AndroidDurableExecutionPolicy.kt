package com.kavi.mobile.durability

private const val MAX_IDENTIFIER_LENGTH = 200
private const val MAX_ATTEMPTS = 10
private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

/**
 * Closed Android scheduling policy. It describes the scheduler a future executor must use; it
 * does not claim that a native/headless executor is currently wired.
 */
internal object AndroidDurableExecutionPolicy {
  fun decide(request: AndroidDurableExecutionRequest): AndroidDurableExecutionDecision {
    if (!isValid(request)) {
      return AndroidDurableExecutionDecision.Unsupported(
        AndroidDurableUnsupportedReason.INVALID_REQUEST,
      )
    }
    if (request.constraints.requiresDeviceIdle) {
      return AndroidDurableExecutionDecision.Unsupported(
        AndroidDurableUnsupportedReason.DEVICE_IDLE_BACKOFF_UNSUPPORTED,
      )
    }

    val unsupportedReason = when (request.durabilityClass) {
      AndroidTaskDurabilityClass.FOREGROUND_INTERACTIVE ->
        AndroidDurableUnsupportedReason.PROCESS_BOUND_INTERACTIVE_WORK
      AndroidTaskDurabilityClass.USER_INITIATED_CONTINUABLE ->
        AndroidDurableUnsupportedReason.NO_GENERAL_AGENT_FOREGROUND_SERVICE_CONTRACT
      AndroidTaskDurabilityClass.EVENT_DRIVEN_MONITOR ->
        AndroidDurableUnsupportedReason.MISSING_EVENT_TRIGGER_CONTRACT
      AndroidTaskDurabilityClass.DEFERRABLE_MAINTENANCE ->
        if (request.identity.commandKind in DEFERRABLE_COMMANDS) null
        else AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND
      AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION -> when {
        request.identity.commandKind != AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES ->
          AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND
        request.constraints.network == AndroidNetworkConstraint.NOT_REQUIRED ->
          AndroidDurableUnsupportedReason.MISSING_REQUIRED_NETWORK_CONSTRAINT
        else -> null
      }
    }
    if (unsupportedReason != null) {
      return AndroidDurableExecutionDecision.Unsupported(unsupportedReason)
    }

    return AndroidDurableExecutionDecision.Supported(
      schedulerKind = AndroidDurableSchedulerKind.WORK_MANAGER_ONE_TIME,
      uniqueWorkName = ANDROID_DURABLE_WORK_NAME_PREFIX + request.identity.runId,
      requiresFreshRecoveryQuery = true,
      requiresFreshAuthorityAndFence = true,
    )
  }

  private fun isValid(request: AndroidDurableExecutionRequest): Boolean {
    val identity = request.identity
    val constraints = request.constraints
    val retryPolicy = request.retryPolicy
    return validId(identity.runId) &&
      identity.controlEpoch >= 0 &&
      identity.snapshotUpdatedAtMillis >= 0 &&
      SHA256_DIGEST.matches(identity.snapshotDigest) &&
      SHA256_DIGEST.matches(identity.commandDigest) &&
      request.requestedAtMillis >= 0 &&
      identity.snapshotUpdatedAtMillis <= request.requestedAtMillis &&
      constraints.earliestStartAtMillis >= request.requestedAtMillis &&
      retryPolicy.maxAttempts in 1..MAX_ATTEMPTS &&
      retryPolicy.initialBackoffMillis in
        WORK_MANAGER_MIN_BACKOFF_MILLIS..WORK_MANAGER_MAX_BACKOFF_MILLIS
  }

  private fun validId(value: String): Boolean =
    value.isNotEmpty() &&
      value.length <= MAX_IDENTIFIER_LENGTH &&
      value == value.trim() &&
      value.none { it.code < 0x20 || it.code == 0x7f }

  private val DEFERRABLE_COMMANDS = setOf(
    AndroidRecoveryCommandKind.RESUME_REVIEW,
    AndroidRecoveryCommandKind.FINALIZE_EXISTING_TERMINAL_PROJECTION,
  )
}
