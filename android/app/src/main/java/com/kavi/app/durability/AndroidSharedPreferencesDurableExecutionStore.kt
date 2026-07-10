package com.kavi.mobile.durability

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

internal const val ANDROID_DURABLE_STORE_NAME = "kavi_android_durable_execution_v1"
internal const val ANDROID_DURABLE_RECORD_KEY_PREFIX = "record.v1."
private const val RECORD_SCHEMA_VERSION = 1
private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

/**
 * Same-process persistent CAS store for the native WorkManager adapter.
 *
 * Android runs this app's workers in the default process. A synchronous SharedPreferences commit
 * makes each complete JSON record durable before the scheduler is called. Unknown schemas and
 * malformed records fail closed; there is intentionally no legacy decoder. Callers must invoke
 * this synchronous store away from the Android main thread.
 */
internal class AndroidSharedPreferencesDurableExecutionStore(
  context: Context,
) : AndroidDurableExecutionStore {
  private val preferences = context.applicationContext.getSharedPreferences(
    ANDROID_DURABLE_STORE_NAME,
    Context.MODE_PRIVATE,
  )

  override fun read(runId: String): AndroidDurableStoreReadResult = synchronized(PROCESS_LOCK) {
    readLocked(runId)
  }

  override fun compareAndSet(
    runId: String,
    expectedRevision: Long?,
    next: AndroidDurableExecutionRecord,
  ): AndroidDurableStoreWriteResult = synchronized(PROCESS_LOCK) {
    if (
      next.request.identity.runId != runId ||
      !validRecord(next) ||
      expectedRevision == Long.MAX_VALUE ||
      next.revision != (expectedRevision?.plus(1) ?: 0L)
    ) {
      return@synchronized AndroidDurableStoreWriteResult.UNAVAILABLE
    }

    val current = readLocked(runId)
    when (current) {
      AndroidDurableStoreReadResult.Unavailable ->
        return@synchronized AndroidDurableStoreWriteResult.UNAVAILABLE
      AndroidDurableStoreReadResult.Missing -> if (expectedRevision != null) {
        return@synchronized AndroidDurableStoreWriteResult.CONFLICT
      }
      is AndroidDurableStoreReadResult.Found -> if (current.record.revision != expectedRevision) {
        return@synchronized AndroidDurableStoreWriteResult.CONFLICT
      }
    }

    val stored = preferences.edit()
      .putString(recordKey(runId), encodeRecord(next).toString())
      .commit()
    if (stored) AndroidDurableStoreWriteResult.STORED
    else AndroidDurableStoreWriteResult.UNAVAILABLE
  }

  private fun readLocked(runId: String): AndroidDurableStoreReadResult {
    val record = try {
      val encoded = preferences.getString(recordKey(runId), null)
        ?: return AndroidDurableStoreReadResult.Missing
      decodeRecord(JSONObject(encoded))
    } catch (_: Exception) {
      null
    }
    return if (record?.request?.identity?.runId == runId) {
      AndroidDurableStoreReadResult.Found(record)
    } else {
      AndroidDurableStoreReadResult.Unavailable
    }
  }

  private companion object {
    /** Shared by every store instance because SharedPreferences CAS is not intrinsically atomic. */
    val PROCESS_LOCK = Any()
  }
}

internal fun androidDurableRecordKey(runId: String): String = recordKey(runId)

private fun recordKey(runId: String): String = ANDROID_DURABLE_RECORD_KEY_PREFIX + runId

private fun encodeRecord(record: AndroidDurableExecutionRecord): JSONObject = JSONObject()
  .put("schema", RECORD_SCHEMA_VERSION)
  .put("request", encodeRequest(record.request))
  .put("scheduler_kind", record.schedulerKind.name)
  .put("unique_work_name", record.uniqueWorkName)
  .put("state", record.state.name)
  .put("attempt", record.attempt)
  .putNullable("next_attempt_at", record.nextAttemptAtMillis)
  .putNullable("failure_reason", record.failureReason?.name)
  .putNullable("receipt_digest", record.receiptDigest)
  .put("revision", record.revision)
  .put("updated_at", record.updatedAtMillis)

private fun encodeRequest(request: AndroidDurableExecutionRequest): JSONObject = JSONObject()
  .put("durability_class", request.durabilityClass.name)
  .put("identity", encodeIdentity(request.identity))
  .put("constraints", encodeConstraints(request.constraints))
  .put("retry_policy", encodeRetryPolicy(request.retryPolicy))
  .put("requested_at", request.requestedAtMillis)

private fun encodeIdentity(identity: AndroidRecoveryCommandIdentity): JSONObject = JSONObject()
  .put("run_id", identity.runId)
  .put("control_epoch", identity.controlEpoch)
  .put("snapshot_updated_at", identity.snapshotUpdatedAtMillis)
  .put("snapshot_digest", identity.snapshotDigest)
  .put("command_kind", identity.commandKind.name)
  .put("command_digest", identity.commandDigest)

private fun encodeConstraints(constraints: AndroidExecutionConstraints): JSONObject = JSONObject()
  .put("network", constraints.network.name)
  .put("requires_charging", constraints.requiresCharging)
  .put("requires_battery_not_low", constraints.requiresBatteryNotLow)
  .put("requires_storage_not_low", constraints.requiresStorageNotLow)
  .put("requires_device_idle", constraints.requiresDeviceIdle)
  .put("earliest_start_at", constraints.earliestStartAtMillis)

private fun encodeRetryPolicy(retryPolicy: AndroidRetryPolicy): JSONObject = JSONObject()
  .put("max_attempts", retryPolicy.maxAttempts)
  .put("backoff_policy", retryPolicy.backoffPolicy.name)
  .put("initial_backoff", retryPolicy.initialBackoffMillis)

private fun JSONObject.putNullable(key: String, value: Any?): JSONObject =
  put(key, value ?: JSONObject.NULL)

private fun decodeRecord(json: JSONObject): AndroidDurableExecutionRecord? {
  if (
    !json.hasExactKeys(
      "schema",
      "request",
      "scheduler_kind",
      "unique_work_name",
      "state",
      "attempt",
      "next_attempt_at",
      "failure_reason",
      "receipt_digest",
      "revision",
      "updated_at",
    ) ||
    json.strictInt("schema") != RECORD_SCHEMA_VERSION
  ) {
    return null
  }
  val record = AndroidDurableExecutionRecord(
    request = decodeRequest(json.getJSONObject("request")) ?: return null,
    schedulerKind = enumValue(json.strictString("scheduler_kind")) ?: return null,
    uniqueWorkName = json.strictString("unique_work_name"),
    state = enumValue(json.strictString("state")) ?: return null,
    attempt = json.strictInt("attempt"),
    nextAttemptAtMillis = json.nullableLong("next_attempt_at"),
    failureReason = json.nullableEnum("failure_reason"),
    receiptDigest = json.nullableString("receipt_digest"),
    revision = json.strictLong("revision"),
    updatedAtMillis = json.strictLong("updated_at"),
  )
  return record.takeIf(::validRecord)
}

private fun decodeRequest(json: JSONObject): AndroidDurableExecutionRequest? {
  if (
    !json.hasExactKeys(
      "durability_class",
      "identity",
      "constraints",
      "retry_policy",
      "requested_at",
    )
  ) {
    return null
  }
  return AndroidDurableExecutionRequest(
    durabilityClass = enumValue(json.strictString("durability_class")) ?: return null,
    identity = decodeIdentity(json.getJSONObject("identity")) ?: return null,
    constraints = decodeConstraints(json.getJSONObject("constraints")) ?: return null,
    retryPolicy = decodeRetryPolicy(json.getJSONObject("retry_policy")) ?: return null,
    requestedAtMillis = json.strictLong("requested_at"),
  )
}

private fun decodeIdentity(json: JSONObject): AndroidRecoveryCommandIdentity? {
  if (
    !json.hasExactKeys(
      "run_id",
      "control_epoch",
      "snapshot_updated_at",
      "snapshot_digest",
      "command_kind",
      "command_digest",
    )
  ) {
    return null
  }
  return AndroidRecoveryCommandIdentity(
    runId = json.strictString("run_id"),
    controlEpoch = json.strictLong("control_epoch"),
    snapshotUpdatedAtMillis = json.strictLong("snapshot_updated_at"),
    snapshotDigest = json.strictString("snapshot_digest"),
    commandKind = enumValue(json.strictString("command_kind")) ?: return null,
    commandDigest = json.strictString("command_digest"),
  )
}

private fun decodeConstraints(json: JSONObject): AndroidExecutionConstraints? {
  if (
    !json.hasExactKeys(
      "network",
      "requires_charging",
      "requires_battery_not_low",
      "requires_storage_not_low",
      "requires_device_idle",
      "earliest_start_at",
    )
  ) {
    return null
  }
  return AndroidExecutionConstraints(
    network = enumValue(json.strictString("network")) ?: return null,
    requiresCharging = json.strictBoolean("requires_charging"),
    requiresBatteryNotLow = json.strictBoolean("requires_battery_not_low"),
    requiresStorageNotLow = json.strictBoolean("requires_storage_not_low"),
    requiresDeviceIdle = json.strictBoolean("requires_device_idle"),
    earliestStartAtMillis = json.strictLong("earliest_start_at"),
  )
}

private fun decodeRetryPolicy(json: JSONObject): AndroidRetryPolicy? {
  if (!json.hasExactKeys("max_attempts", "backoff_policy", "initial_backoff")) {
    return null
  }
  return AndroidRetryPolicy(
    maxAttempts = json.strictInt("max_attempts"),
    backoffPolicy = enumValue(json.strictString("backoff_policy")) ?: return null,
    initialBackoffMillis = json.strictLong("initial_backoff"),
  )
}

private fun validRecord(record: AndroidDurableExecutionRecord): Boolean {
  val decision = AndroidDurableExecutionPolicy.decide(record.request)
  if (
    decision !is AndroidDurableExecutionDecision.Supported ||
    record.schedulerKind != decision.schedulerKind ||
    record.uniqueWorkName != decision.uniqueWorkName ||
    record.revision < 0 ||
    record.updatedAtMillis < record.request.requestedAtMillis ||
    record.attempt !in 0..record.request.retryPolicy.maxAttempts ||
    (record.receiptDigest != null && !SHA256_DIGEST.matches(record.receiptDigest))
  ) {
    return false
  }

  return when (record.state) {
    AndroidDurableExecutionState.SCHEDULING,
    AndroidDurableExecutionState.ENQUEUED -> record.attempt == 0 && record.hasNoOutcome()
    AndroidDurableExecutionState.RUNNING -> record.attempt >= 1 && record.hasNoOutcome()
    AndroidDurableExecutionState.RETRY_WAITING ->
        record.attempt in 1 until record.request.retryPolicy.maxAttempts &&
        record.nextAttemptAtMillis != null &&
        record.nextAttemptAtMillis >= minimumRetryAt(record) &&
        record.failureReason == AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE &&
        record.receiptDigest == null
    AndroidDurableExecutionState.CANCEL_REQUESTED,
    AndroidDurableExecutionState.CANCELLED -> record.nextAttemptAtMillis == null &&
      record.failureReason == null &&
      record.receiptDigest == null
    AndroidDurableExecutionState.COMPLETED ->
      record.attempt >= 1 &&
        record.nextAttemptAtMillis == null &&
        record.failureReason == null &&
        record.receiptDigest != null
    AndroidDurableExecutionState.BLOCKED ->
      record.nextAttemptAtMillis == null &&
        record.failureReason != null &&
        record.receiptDigest == null
  }
}

private fun AndroidDurableExecutionRecord.hasNoOutcome(): Boolean =
  nextAttemptAtMillis == null && failureReason == null && receiptDigest == null

private fun minimumRetryAt(record: AndroidDurableExecutionRecord): Long {
  var backoff = record.request.retryPolicy.initialBackoffMillis
  repeat((record.attempt - 1).coerceAtLeast(0)) {
    backoff = (backoff * 2).coerceAtMost(WORK_MANAGER_MAX_BACKOFF_MILLIS)
  }
  return if (record.updatedAtMillis > Long.MAX_VALUE - backoff) {
    Long.MAX_VALUE
  } else {
    record.updatedAtMillis + backoff
  }
}

private fun JSONObject.hasExactKeys(vararg expected: String): Boolean {
  val actual = keys().asSequence().toSet()
  return actual == expected.toSet()
}

private fun JSONObject.nullableLong(key: String): Long? =
  if (isNull(key)) null else strictLong(key)

private fun JSONObject.nullableString(key: String): String? =
  if (isNull(key)) null else strictString(key)

private inline fun <reified T : Enum<T>> JSONObject.nullableEnum(key: String): T? =
  if (isNull(key)) null else enumValue(strictString(key))

private fun JSONObject.strictString(key: String): String =
  (get(key) as? String) ?: throw IllegalArgumentException("$key must be a string")

private fun JSONObject.strictBoolean(key: String): Boolean =
  (get(key) as? Boolean) ?: throw IllegalArgumentException("$key must be a boolean")

private fun JSONObject.strictInt(key: String): Int {
  val value = strictLong(key)
  if (value !in Int.MIN_VALUE..Int.MAX_VALUE) {
    throw IllegalArgumentException("$key is outside the integer range")
  }
  return value.toInt()
}

private fun JSONObject.strictLong(key: String): Long = when (val value = get(key)) {
  is Byte -> value.toLong()
  is Short -> value.toLong()
  is Int -> value.toLong()
  is Long -> value
  else -> throw IllegalArgumentException("$key must be an integer")
}

private inline fun <reified T : Enum<T>> enumValue(value: String): T? =
  enumValues<T>().singleOrNull { it.name == value }
