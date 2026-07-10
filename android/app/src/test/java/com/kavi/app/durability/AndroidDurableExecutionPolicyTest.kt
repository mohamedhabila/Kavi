package com.kavi.mobile.durability

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDurableExecutionPolicyTest {
  @Test
  fun `external reconciliation maps to finite WorkManager request`() {
    val decision = AndroidDurableExecutionPolicy.decide(
      request(
        durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
        commandKind = AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
      ),
    )

    assertEquals(
      AndroidDurableExecutionDecision.Supported(
        schedulerKind = AndroidDurableSchedulerKind.WORK_MANAGER_ONE_TIME,
        uniqueWorkName = "${ANDROID_DURABLE_WORK_NAME_PREFIX}run-1",
        requiresFreshRecoveryQuery = true,
        requiresFreshAuthorityAndFence = true,
      ),
      decision,
    )
  }

  @Test
  fun `only effect-safe deferrable recovery commands are schedulable`() {
    for (
      commandKind in listOf(
        AndroidRecoveryCommandKind.RESUME_REVIEW,
        AndroidRecoveryCommandKind.FINALIZE_EXISTING_TERMINAL_PROJECTION,
      )
    ) {
      assertTrue(
        AndroidDurableExecutionPolicy.decide(
          request(
            durabilityClass = AndroidTaskDurabilityClass.DEFERRABLE_MAINTENANCE,
            commandKind = commandKind,
          ),
        ) is AndroidDurableExecutionDecision.Supported,
      )
    }
  }

  @Test
  fun `persisted tool effects never map directly to Android background execution`() {
    val decision = AndroidDurableExecutionPolicy.decide(
      request(
        durabilityClass = AndroidTaskDurabilityClass.DEFERRABLE_MAINTENANCE,
        commandKind = AndroidRecoveryCommandKind.RESUME_PERSISTED_TOOL_BATCH,
      ),
    )

    assertEquals(
      AndroidDurableExecutionDecision.Unsupported(
        AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND,
      ),
      decision,
    )
  }

  @Test
  fun `process bound and triggerless classes fail closed`() {
    val expected = mapOf(
      AndroidTaskDurabilityClass.FOREGROUND_INTERACTIVE to
        AndroidDurableUnsupportedReason.PROCESS_BOUND_INTERACTIVE_WORK,
      AndroidTaskDurabilityClass.USER_INITIATED_CONTINUABLE to
        AndroidDurableUnsupportedReason.NO_GENERAL_AGENT_FOREGROUND_SERVICE_CONTRACT,
      AndroidTaskDurabilityClass.EVENT_DRIVEN_MONITOR to
        AndroidDurableUnsupportedReason.MISSING_EVENT_TRIGGER_CONTRACT,
    )

    for ((durabilityClass, reason) in expected) {
      assertEquals(
        AndroidDurableExecutionDecision.Unsupported(reason),
        AndroidDurableExecutionPolicy.decide(request(durabilityClass = durabilityClass)),
      )
    }
  }

  @Test
  fun `invalid identity constraints and retry policy fail closed`() {
    val invalidRequests = listOf(
      request(identity = identity(runId = " run-1")),
      request(identity = identity(controlEpoch = -1)),
      request(identity = identity(snapshotDigest = "not-a-digest")),
      request(constraints = constraints(earliestStartAtMillis = 99)),
      request(retryPolicy = AndroidRetryPolicy(maxAttempts = 11, initialBackoffMillis = 10_000)),
      request(retryPolicy = AndroidRetryPolicy(maxAttempts = 2, initialBackoffMillis = 9_999)),
    )

    for (invalidRequest in invalidRequests) {
      assertEquals(
        AndroidDurableExecutionDecision.Unsupported(
          AndroidDurableUnsupportedReason.INVALID_REQUEST,
        ),
        AndroidDurableExecutionPolicy.decide(invalidRequest),
      )
    }
  }

  private fun request(
    durabilityClass: AndroidTaskDurabilityClass =
      AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
    commandKind: AndroidRecoveryCommandKind =
      AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
    identity: AndroidRecoveryCommandIdentity = identity(commandKind = commandKind),
    constraints: AndroidExecutionConstraints = constraints(),
    retryPolicy: AndroidRetryPolicy = AndroidRetryPolicy(
      maxAttempts = 3,
      initialBackoffMillis = 10_000,
    ),
  ) = AndroidDurableExecutionRequest(
    durabilityClass = durabilityClass,
    identity = identity,
    constraints = constraints,
    retryPolicy = retryPolicy,
    requestedAtMillis = 100,
  )

  private fun identity(
    runId: String = "run-1",
    controlEpoch: Long = 2,
    snapshotDigest: String = "a".repeat(64),
    commandKind: AndroidRecoveryCommandKind =
      AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
  ) = AndroidRecoveryCommandIdentity(
    runId = runId,
    controlEpoch = controlEpoch,
    snapshotDigest = snapshotDigest,
    commandKind = commandKind,
    commandDigest = "b".repeat(64),
  )

  private fun constraints(earliestStartAtMillis: Long = 100) = AndroidExecutionConstraints(
    network = AndroidNetworkConstraint.CONNECTED,
    requiresCharging = false,
    requiresBatteryNotLow = true,
    requiresStorageNotLow = true,
    requiresDeviceIdle = false,
    earliestStartAtMillis = earliestStartAtMillis,
  )
}
