package com.kavi.mobile.durability

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.util.Locale

internal const val ANDROID_DURABLE_BRIDGE_SCHEMA = 1
private const val JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991L

internal class AndroidDurableBridgeContractException(message: String) :
  IllegalArgumentException(message)

internal object AndroidDurableBridgeCodec {
  fun decodeRequest(map: ReadableMap): AndroidDurableExecutionRequest {
    map.requireExactKeys(
      "request",
      "schema",
      "durabilityClass",
      "identity",
      "constraints",
      "retryPolicy",
      "requestedAtMillis",
    )
    map.requireSchema("request")
    val identity = map.strictMap("identity", "request")
    identity.requireExactKeys(
      "request.identity",
      "runId",
      "controlEpoch",
      "snapshotUpdatedAtMillis",
      "snapshotDigest",
      "commandKind",
      "commandDigest",
    )
    val constraints = map.strictMap("constraints", "request")
    constraints.requireExactKeys(
      "request.constraints",
      "network",
      "requiresCharging",
      "requiresBatteryNotLow",
      "requiresStorageNotLow",
      "requiresDeviceIdle",
      "earliestStartAtMillis",
    )
    val retryPolicy = map.strictMap("retryPolicy", "request")
    retryPolicy.requireExactKeys(
      "request.retryPolicy",
      "maxAttempts",
      "backoffPolicy",
      "initialBackoffMillis",
    )
    return AndroidDurableExecutionRequest(
      durabilityClass = map.strictEnum("durabilityClass", "request"),
      identity = AndroidRecoveryCommandIdentity(
        runId = identity.strictString("runId", "request.identity"),
        controlEpoch = identity.strictLong("controlEpoch", "request.identity"),
        snapshotUpdatedAtMillis = identity.strictLong(
          "snapshotUpdatedAtMillis",
          "request.identity",
        ),
        snapshotDigest = identity.strictString("snapshotDigest", "request.identity"),
        commandKind = identity.strictEnum("commandKind", "request.identity"),
        commandDigest = identity.strictString("commandDigest", "request.identity"),
      ),
      constraints = AndroidExecutionConstraints(
        network = constraints.strictEnum("network", "request.constraints"),
        requiresCharging = constraints.strictBoolean(
          "requiresCharging",
          "request.constraints",
        ),
        requiresBatteryNotLow = constraints.strictBoolean(
          "requiresBatteryNotLow",
          "request.constraints",
        ),
        requiresStorageNotLow = constraints.strictBoolean(
          "requiresStorageNotLow",
          "request.constraints",
        ),
        requiresDeviceIdle = constraints.strictBoolean(
          "requiresDeviceIdle",
          "request.constraints",
        ),
        earliestStartAtMillis = constraints.strictLong(
          "earliestStartAtMillis",
          "request.constraints",
        ),
      ),
      retryPolicy = AndroidRetryPolicy(
        maxAttempts = retryPolicy.strictInt("maxAttempts", "request.retryPolicy"),
        backoffPolicy = retryPolicy.strictEnum("backoffPolicy", "request.retryPolicy"),
        initialBackoffMillis = retryPolicy.strictLong(
          "initialBackoffMillis",
          "request.retryPolicy",
        ),
      ),
      requestedAtMillis = map.strictLong("requestedAtMillis", "request"),
    )
  }

  fun decodePointer(map: ReadableMap): AndroidDurableExecutionPointer {
    map.requireExactKeys(
      "pointer",
      "schema",
      "runId",
      "controlEpoch",
      "snapshotUpdatedAtMillis",
      "snapshotDigest",
      "commandDigest",
    )
    map.requireSchema("pointer")
    return decodePointerBody(map, "pointer")
  }

  fun decodeAttemptPointer(map: ReadableMap): AndroidDurableExecutionAttemptPointer {
    map.requireExactKeys("attemptPointer", "schema", "generation", "attempt")
    map.requireSchema("attemptPointer")
    val generation = map.strictMap("generation", "attemptPointer")
    generation.requireExactKeys(
      "attemptPointer.generation",
      "runId",
      "controlEpoch",
      "snapshotUpdatedAtMillis",
      "snapshotDigest",
      "commandDigest",
    )
    return AndroidDurableExecutionAttemptPointer(
      generation = decodePointerBody(generation, "attemptPointer.generation"),
      attempt = map.strictInt("attempt", "attemptPointer"),
    )
  }

  fun decodeTimestamp(value: Double, field: String): Long = value.strictLong(field)

  fun decodeLimit(value: Double): Int {
    val limit = value.strictLong("limit")
    if (limit !in 1..1_000) {
      throw AndroidDurableBridgeContractException("limit is outside the supported range")
    }
    return limit.toInt()
  }

  fun decodeRunId(value: String): String {
    if (value.isEmpty() || value.length > 200 || value != value.trim()) {
      throw AndroidDurableBridgeContractException("runId is invalid")
    }
    return value
  }

  fun decodeRetryReason(value: String): AndroidDurableFailureReason = when (value) {
    "transient_unavailable" -> AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE
    "remote_still_pending" -> AndroidDurableFailureReason.REMOTE_STILL_PENDING
    "provider_temporarily_unavailable" ->
      AndroidDurableFailureReason.PROVIDER_TEMPORARILY_UNAVAILABLE
    else -> throw AndroidDurableBridgeContractException("retry reason is unsupported")
  }

  fun decodeBlockReason(value: String): AndroidDurableFailureReason = when (value) {
    "generation_changed" -> AndroidDurableFailureReason.GENERATION_CHANGED
    "authority_changed" -> AndroidDurableFailureReason.AUTHORITY_CHANGED
    "handler_rejected" -> AndroidDurableFailureReason.HANDLER_REJECTED
    "handler_failed" -> AndroidDurableFailureReason.HANDLER_FAILED
    else -> throw AndroidDurableBridgeContractException("block reason is unsupported")
  }

  fun encodeAdapterResult(result: AndroidDurableAdapterResult): WritableMap {
    val output = Arguments.createMap()
    output.putInt("schema", ANDROID_DURABLE_BRIDGE_SCHEMA)
    when (result) {
      is AndroidDurableAdapterResult.Accepted -> {
        output.putString("status", "accepted")
        output.putNull("reason")
        output.putMap("record", encodeRecord(result.record))
      }
      is AndroidDurableAdapterResult.NoOp -> {
        output.putString("status", "no_op")
        output.putNull("reason")
        output.putMap("record", encodeRecord(result.record))
      }
      is AndroidDurableAdapterResult.Released -> {
        output.putString("status", "released")
        output.putNull("reason")
        output.putMap("record", encodeRecord(result.terminalRecord))
      }
      is AndroidDurableAdapterResult.Unsupported -> {
        output.putString("status", "unsupported")
        output.putString("reason", result.reason.bridgeName())
        output.putNull("record")
      }
      is AndroidDurableAdapterResult.Rejected -> {
        output.putString("status", "rejected")
        output.putString("reason", result.reason.bridgeName())
        output.putNull("record")
      }
      is AndroidDurableAdapterResult.Deferred -> {
        output.putString("status", "deferred")
        output.putString("reason", result.reason.bridgeName())
        output.putNull("record")
      }
    }
    return output
  }

  fun encodeReadResult(result: AndroidDurableStoreReadResult): WritableMap =
    Arguments.createMap().apply {
      putInt("schema", ANDROID_DURABLE_BRIDGE_SCHEMA)
      when (result) {
        is AndroidDurableStoreReadResult.Found -> {
          putString("status", "found")
          putMap("record", encodeRecord(result.record))
        }
        AndroidDurableStoreReadResult.Missing -> {
          putString("status", "missing")
          putNull("record")
        }
        AndroidDurableStoreReadResult.Unavailable -> {
          putString("status", "unavailable")
          putNull("record")
        }
      }
    }

  fun encodeReconciliation(result: AndroidDurableOutboxReconciliation): WritableMap =
    Arguments.createMap().apply {
      putInt("schema", ANDROID_DURABLE_BRIDGE_SCHEMA)
      putMap("scheduling", encodeReconciliationSide(result.scheduling))
      putMap("cancellation", encodeReconciliationSide(result.cancellation))
    }

  private fun encodeRecord(record: AndroidDurableExecutionRecord): WritableMap =
    Arguments.createMap().apply {
      putMap("request", encodeRequest(record.request))
      putString("schedulerKind", record.schedulerKind.bridgeName())
      putString("uniqueWorkName", record.uniqueWorkName)
      putString("platformWorkId", record.platformWorkId)
      putString("state", record.state.bridgeName())
      putInt("attempt", record.attempt)
      putNullableSafeLong("nextAttemptAtMillis", record.nextAttemptAtMillis)
      putNullableString("failureReason", record.failureReason?.bridgeName())
      putNullableString("receiptDigest", record.receiptDigest)
      putSafeLong("revision", record.revision)
      putSafeLong("updatedAtMillis", record.updatedAtMillis)
    }

  private fun encodeRequest(request: AndroidDurableExecutionRequest): WritableMap =
    Arguments.createMap().apply {
      putInt("schema", ANDROID_DURABLE_BRIDGE_SCHEMA)
      putString("durabilityClass", request.durabilityClass.bridgeName())
      putMap("identity", Arguments.createMap().apply {
        putString("runId", request.identity.runId)
        putSafeLong("controlEpoch", request.identity.controlEpoch)
        putSafeLong("snapshotUpdatedAtMillis", request.identity.snapshotUpdatedAtMillis)
        putString("snapshotDigest", request.identity.snapshotDigest)
        putString("commandKind", request.identity.commandKind.bridgeName())
        putString("commandDigest", request.identity.commandDigest)
      })
      putMap("constraints", Arguments.createMap().apply {
        putString("network", request.constraints.network.bridgeName())
        putBoolean("requiresCharging", request.constraints.requiresCharging)
        putBoolean("requiresBatteryNotLow", request.constraints.requiresBatteryNotLow)
        putBoolean("requiresStorageNotLow", request.constraints.requiresStorageNotLow)
        putBoolean("requiresDeviceIdle", request.constraints.requiresDeviceIdle)
        putSafeLong("earliestStartAtMillis", request.constraints.earliestStartAtMillis)
      })
      putMap("retryPolicy", Arguments.createMap().apply {
        putInt("maxAttempts", request.retryPolicy.maxAttempts)
        putString("backoffPolicy", request.retryPolicy.backoffPolicy.bridgeName())
        putSafeLong("initialBackoffMillis", request.retryPolicy.initialBackoffMillis)
      })
      putSafeLong("requestedAtMillis", request.requestedAtMillis)
    }

  private fun encodeReconciliationSide(
    result: AndroidDurableOutboxReconciliationResult,
  ): WritableMap = Arguments.createMap().apply {
    when (result) {
      is AndroidDurableOutboxReconciliationResult.Completed -> {
        putString("status", "completed")
        val outcomes: WritableArray = Arguments.createArray()
        result.outcomes.forEach { outcome ->
          outcomes.pushMap(Arguments.createMap().apply {
            putString("runId", outcome.runId)
            putMap("result", encodeAdapterResult(outcome.result))
          })
        }
        putArray("outcomes", outcomes)
      }
      AndroidDurableOutboxReconciliationResult.StoreUnavailable -> {
        putString("status", "store_unavailable")
        putArray("outcomes", Arguments.createArray())
      }
    }
  }

  private fun decodePointerBody(
    map: ReadableMap,
    path: String,
  ) = AndroidDurableExecutionPointer(
    runId = map.strictString("runId", path),
    controlEpoch = map.strictLong("controlEpoch", path),
    snapshotUpdatedAtMillis = map.strictLong("snapshotUpdatedAtMillis", path),
    snapshotDigest = map.strictString("snapshotDigest", path),
    commandDigest = map.strictString("commandDigest", path),
  )
}

private fun ReadableMap.requireSchema(path: String) {
  if (strictInt("schema", path) != ANDROID_DURABLE_BRIDGE_SCHEMA) {
    throw AndroidDurableBridgeContractException("$path schema is unsupported")
  }
}

private fun ReadableMap.requireExactKeys(path: String, vararg expected: String) {
  val keys = buildSet {
    val iterator = keySetIterator()
    while (iterator.hasNextKey()) add(iterator.nextKey())
  }
  if (keys != expected.toSet()) {
    throw AndroidDurableBridgeContractException("$path has an invalid shape")
  }
}

private fun ReadableMap.strictString(key: String, path: String): String {
  if (getType(key) != ReadableType.String) {
    throw AndroidDurableBridgeContractException("$path.$key must be a string")
  }
  return getString(key)
    ?: throw AndroidDurableBridgeContractException("$path.$key must be a string")
}

private fun ReadableMap.strictBoolean(key: String, path: String): Boolean {
  if (getType(key) != ReadableType.Boolean) {
    throw AndroidDurableBridgeContractException("$path.$key must be a boolean")
  }
  return getBoolean(key)
}

private fun ReadableMap.strictMap(key: String, path: String): ReadableMap {
  if (getType(key) != ReadableType.Map) {
    throw AndroidDurableBridgeContractException("$path.$key must be an object")
  }
  return getMap(key)
    ?: throw AndroidDurableBridgeContractException("$path.$key must be an object")
}

private fun ReadableMap.strictLong(key: String, path: String): Long {
  if (getType(key) != ReadableType.Number) {
    throw AndroidDurableBridgeContractException("$path.$key must be an integer")
  }
  return getDouble(key).strictLong("$path.$key")
}

private fun ReadableMap.strictInt(key: String, path: String): Int {
  val value = strictLong(key, path)
  if (value !in Int.MIN_VALUE..Int.MAX_VALUE) {
    throw AndroidDurableBridgeContractException("$path.$key is outside the integer range")
  }
  return value.toInt()
}

private inline fun <reified T : Enum<T>> ReadableMap.strictEnum(
  key: String,
  path: String,
): T {
  val value = strictString(key, path)
  return enumValues<T>().singleOrNull { it.bridgeName() == value }
    ?: throw AndroidDurableBridgeContractException("$path.$key is unsupported")
}

private fun Double.strictLong(field: String): Long {
  if (!isFinite() || this % 1.0 != 0.0 || this < 0 || this > JS_MAX_SAFE_INTEGER.toDouble()) {
    throw AndroidDurableBridgeContractException("$field must be a safe non-negative integer")
  }
  return toLong()
}

private fun WritableMap.putSafeLong(key: String, value: Long) {
  if (value !in 0..JS_MAX_SAFE_INTEGER) {
    throw IllegalStateException("$key cannot be represented by the bridge")
  }
  putDouble(key, value.toDouble())
}

private fun WritableMap.putNullableSafeLong(key: String, value: Long?) {
  if (value == null) putNull(key) else putSafeLong(key, value)
}

private fun WritableMap.putNullableString(key: String, value: String?) {
  if (value == null) putNull(key) else putString(key, value)
}

private fun Enum<*>.bridgeName(): String = name.lowercase(Locale.ROOT)
