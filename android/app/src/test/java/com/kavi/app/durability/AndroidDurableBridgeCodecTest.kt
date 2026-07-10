package com.kavi.mobile.durability

import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidDurableBridgeCodecTest {
  @Test
  fun `request decoder accepts only the exact versioned contract`() {
    assertEquals(request(), AndroidDurableBridgeCodec.decodeRequest(requestMap()))

    assertContractFailure(requestMap().apply { putString("extra", "rejected") })
    assertContractFailure(requestMap().apply { putInt("schema", 2) })
    assertContractFailure(requestMap().apply {
      putMap("identity", identityMap().apply { putDouble("controlEpoch", 1.5) })
    })
    assertContractFailure(requestMap().apply {
      putMap("constraints", constraintsMap().apply { putString("network", "unknown") })
    })
  }

  @Test
  fun `generation and attempt pointers reject aliases and unsafe numbers`() {
    val pointer = pointerMap()
    assertEquals(pointer(), AndroidDurableBridgeCodec.decodePointer(pointer))
    assertEquals(
      AndroidDurableExecutionAttemptPointer(pointer(), 2),
      AndroidDurableBridgeCodec.decodeAttemptPointer(
        JavaOnlyMap.of(
          "schema",
          1,
          "generation",
          pointerBodyMap(),
          "attempt",
          2,
        ),
      ),
    )

    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodePointer(pointerMap().apply {
        putString("snapshot_updated_at", "alias")
      })
    }
    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodeTimestamp(Double.NaN, "updatedAtMillis")
    }
    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodeTimestamp(9_007_199_254_740_992.0, "updatedAtMillis")
    }
  }

  @Test
  fun `outcome reasons are closed by transition type`() {
    assertEquals(
      AndroidDurableFailureReason.REMOTE_STILL_PENDING,
      AndroidDurableBridgeCodec.decodeRetryReason("remote_still_pending"),
    )
    assertEquals(
      AndroidDurableFailureReason.AUTHORITY_CHANGED,
      AndroidDurableBridgeCodec.decodeBlockReason("authority_changed"),
    )
    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodeRetryReason("handler_failed")
    }
    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodeBlockReason("retry_exhausted")
    }
  }

  private fun assertContractFailure(map: JavaOnlyMap) {
    assertThrows(AndroidDurableBridgeContractException::class.java) {
      AndroidDurableBridgeCodec.decodeRequest(map)
    }
  }

  private fun requestMap() = JavaOnlyMap.of(
    "schema",
    1,
    "durabilityClass",
    "external_durable_operation",
    "identity",
    identityMap(),
    "constraints",
    constraintsMap(),
    "retryPolicy",
    JavaOnlyMap.of(
      "maxAttempts",
      3,
      "backoffPolicy",
      "exponential",
      "initialBackoffMillis",
      10_000.0,
    ),
    "requestedAtMillis",
    100.0,
  )

  private fun identityMap() = JavaOnlyMap.of(
    "runId",
    "run-bridge",
    "controlEpoch",
    4.0,
    "snapshotUpdatedAtMillis",
    90.0,
    "snapshotDigest",
    "a".repeat(64),
    "commandKind",
    "reconcile_external_handles",
    "commandDigest",
    "b".repeat(64),
  )

  private fun constraintsMap() = JavaOnlyMap.of(
    "network",
    "connected",
    "requiresCharging",
    false,
    "requiresBatteryNotLow",
    true,
    "requiresStorageNotLow",
    true,
    "requiresDeviceIdle",
    false,
    "earliestStartAtMillis",
    100.0,
  )

  private fun pointerMap() = JavaOnlyMap.of(
    "schema",
    1,
    "runId",
    "run-bridge",
    "controlEpoch",
    4.0,
    "snapshotUpdatedAtMillis",
    90.0,
    "snapshotDigest",
    "a".repeat(64),
    "commandDigest",
    "b".repeat(64),
  )

  private fun pointerBodyMap() = JavaOnlyMap.of(
    "runId",
    "run-bridge",
    "controlEpoch",
    4.0,
    "snapshotUpdatedAtMillis",
    90.0,
    "snapshotDigest",
    "a".repeat(64),
    "commandDigest",
    "b".repeat(64),
  )

  private fun request() = AndroidDurableExecutionRequest(
    durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
    identity = AndroidRecoveryCommandIdentity(
      runId = "run-bridge",
      controlEpoch = 4,
      snapshotUpdatedAtMillis = 90,
      snapshotDigest = "a".repeat(64),
      commandKind = AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
      commandDigest = "b".repeat(64),
    ),
    constraints = AndroidExecutionConstraints(
      network = AndroidNetworkConstraint.CONNECTED,
      requiresCharging = false,
      requiresBatteryNotLow = true,
      requiresStorageNotLow = true,
      requiresDeviceIdle = false,
      earliestStartAtMillis = 100,
    ),
    retryPolicy = AndroidRetryPolicy(
      maxAttempts = 3,
      backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
      initialBackoffMillis = 10_000,
    ),
    requestedAtMillis = 100,
  )

  private fun pointer() = AndroidDurableExecutionPointer(
    runId = "run-bridge",
    controlEpoch = 4,
    snapshotUpdatedAtMillis = 90,
    snapshotDigest = "a".repeat(64),
    commandDigest = "b".repeat(64),
  )
}
