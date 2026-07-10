package com.kavi.mobile.durability

import org.junit.Assert.assertEquals
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
        uniqueWorkName = "${ANDROID_DURABLE_WORK_NAME_PREFIX}run-1.${"b".repeat(64)}",
        requiresFreshRecoveryQuery = true,
        requiresFreshAuthorityAndFence = true,
      ),
      decision,
    )
  }

  @Test
  fun `commands without a production headless handler fail closed`() {
    for (commandKind in AndroidRecoveryCommandKind.entries) {
      assertEquals(
        AndroidDurableExecutionDecision.Unsupported(
          AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND,
        ),
        AndroidDurableExecutionPolicy.decide(
          request(
            durabilityClass = AndroidTaskDurabilityClass.DEFERRABLE_MAINTENANCE,
            commandKind = commandKind,
          ),
        ),
      )
    }
    for (
      commandKind in AndroidRecoveryCommandKind.entries
        .filterNot { it == AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES }
    ) {
      assertEquals(
        AndroidDurableExecutionDecision.Unsupported(
          AndroidDurableUnsupportedReason.UNSAFE_RECOVERY_COMMAND,
        ),
        AndroidDurableExecutionPolicy.decide(
          request(
            durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
            commandKind = commandKind,
          ),
        ),
      )
    }
  }

  @Test
  fun `external reconciliation requires an Android network constraint`() {
    val decision = AndroidDurableExecutionPolicy.decide(
      request(
        constraints = constraints(network = AndroidNetworkConstraint.NOT_REQUIRED),
      ),
    )

    assertEquals(
      AndroidDurableExecutionDecision.Unsupported(
        AndroidDurableUnsupportedReason.MISSING_REQUIRED_NETWORK_CONSTRAINT,
      ),
      decision,
    )
  }

  @Test
  fun `device idle is rejected because WorkManager cannot apply the retry contract`() {
    val decision = AndroidDurableExecutionPolicy.decide(
      request(constraints = constraints(requiresDeviceIdle = true)),
    )

    assertEquals(
      AndroidDurableExecutionDecision.Unsupported(
        AndroidDurableUnsupportedReason.DEVICE_IDLE_BACKOFF_UNSUPPORTED,
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
      request(identity = identity(snapshotUpdatedAtMillis = -1)),
      request(identity = identity(snapshotUpdatedAtMillis = 101)),
      request(identity = identity(snapshotDigest = "not-a-digest")),
      request(constraints = constraints(earliestStartAtMillis = 99)),
      request(
        retryPolicy = AndroidRetryPolicy(
          maxAttempts = 11,
          backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
          initialBackoffMillis = 10_000,
        ),
      ),
      request(
        retryPolicy = AndroidRetryPolicy(
          maxAttempts = 2,
          backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
          initialBackoffMillis = 9_999,
        ),
      ),
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
      backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
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
    snapshotUpdatedAtMillis: Long = 90,
    snapshotDigest: String = "a".repeat(64),
    commandKind: AndroidRecoveryCommandKind =
      AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
  ) = AndroidRecoveryCommandIdentity(
    runId = runId,
    controlEpoch = controlEpoch,
    snapshotUpdatedAtMillis = snapshotUpdatedAtMillis,
    snapshotDigest = snapshotDigest,
    commandKind = commandKind,
    commandDigest = "b".repeat(64),
  )

  private fun constraints(
    network: AndroidNetworkConstraint = AndroidNetworkConstraint.CONNECTED,
    earliestStartAtMillis: Long = 100,
    requiresDeviceIdle: Boolean = false,
  ) = AndroidExecutionConstraints(
    network = network,
    requiresCharging = false,
    requiresBatteryNotLow = true,
    requiresStorageNotLow = true,
    requiresDeviceIdle = requiresDeviceIdle,
    earliestStartAtMillis = earliestStartAtMillis,
  )
}
