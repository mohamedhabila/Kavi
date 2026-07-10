package com.kavi.mobile.durability

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

private const val MAX_IDENTIFIER_LENGTH = 200
private const val MAX_ATTEMPTS = 10
private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

/**
 * Closed Android scheduling policy. Only commands with a production headless handler may cross
 * this boundary; every other known recovery command remains foreground-owned.
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
        AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND
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
      uniqueWorkName = uniqueWorkName(request.identity),
      requiresFreshRecoveryQuery = true,
      requiresFreshAuthorityAndFence = true,
    )
  }

  internal fun uniqueWorkName(identity: AndroidRecoveryCommandIdentity): String {
    val canonicalIdentity = buildString {
      append(identity.runId.length)
      append(':')
      append(identity.runId)
      append('|')
      append(identity.controlEpoch)
      append('|')
      append(identity.snapshotUpdatedAtMillis)
      append('|')
      append(identity.snapshotDigest)
      append('|')
      append(identity.commandKind.name)
      append('|')
      append(identity.commandDigest)
    }
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(canonicalIdentity.toByteArray(StandardCharsets.UTF_8))
      .joinToString(separator = "") { byte ->
        byte.toUByte().toString(radix = 16).padStart(length = 2, padChar = '0')
      }
    return ANDROID_DURABLE_WORK_NAME_PREFIX + digest
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
}
