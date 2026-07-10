package com.kavi.mobile.durability

import android.content.ContentValues
import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

internal const val ANDROID_DURABLE_DATABASE_NAME = "kavi_android_durable_execution_v1.db"
internal const val ANDROID_DURABLE_CORRUPTION_MARKER_NAME =
  "kavi_android_durable_execution_v1.corrupt"
private const val RECORD_SCHEMA_VERSION = 1
private const val DATABASE_SCHEMA_VERSION = 1
private const val RECORD_TABLE = "durable_execution_records"
private const val COLUMN_RUN_ID = "run_id"
private const val COLUMN_PLATFORM_WORK_ID = "platform_work_id"
private const val COLUMN_REVISION = "revision"
private const val COLUMN_STATE = "state"
private const val COLUMN_UPDATED_AT = "updated_at"
private const val COLUMN_RECORD = "record_json"
private const val MAX_SCHEDULING_LIST_LIMIT = 1_000
private val RECORD_COLUMNS = arrayOf(
  COLUMN_RUN_ID,
  COLUMN_PLATFORM_WORK_ID,
  COLUMN_REVISION,
  COLUMN_STATE,
  COLUMN_UPDATED_AT,
  COLUMN_RECORD,
)
private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

/**
 * Transactional persistent CAS store for the native WorkManager adapter.
 *
 * Each run is one SQLite row, so one update does not rewrite every durable record. The database,
 * WAL, and shared-memory files live under noBackupFilesDir because restoring these records without
 * the corresponding WorkManager database would violate their scheduling contract. Unknown
 * schemas, malformed records, and database corruption fail closed; there is intentionally no
 * legacy decoder or destructive corruption recovery. Callers must invoke this synchronous store
 * away from the Android main thread.
 */
internal class AndroidSqliteDurableExecutionStore(
  context: Context,
) : AndroidDurableExecutionStore, AutoCloseable {
  private val databaseHealth = DurableDatabaseHealth(context.applicationContext)
  private val helperDelegate = lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
    DurableDatabaseHelper(context.applicationContext, databaseHealth)
  }
  private val helper by helperDelegate

  override fun read(runId: String): AndroidDurableStoreReadResult = if (
    databaseHealth.isCorrupted()
  ) {
    AndroidDurableStoreReadResult.Unavailable
  } else try {
    readFrom(helper.readableDatabase, runId)
  } catch (_: Exception) {
    AndroidDurableStoreReadResult.Unavailable
  }

  override fun readByWorkId(platformWorkId: String): AndroidDurableStoreReadResult = if (
    !validUuid(platformWorkId) || databaseHealth.isCorrupted()
  ) {
    AndroidDurableStoreReadResult.Unavailable
  } else try {
    readSingle(
      database = helper.readableDatabase,
      selection = "$COLUMN_PLATFORM_WORK_ID = ?",
      selectionArgs = arrayOf(platformWorkId),
    )
  } catch (_: Exception) {
    AndroidDurableStoreReadResult.Unavailable
  }

  override fun listScheduling(limit: Int): AndroidDurableStoreListResult = listState(
    AndroidDurableExecutionState.SCHEDULING,
    limit,
  )

  override fun listCancellationRequested(limit: Int): AndroidDurableStoreListResult = listState(
    AndroidDurableExecutionState.CANCEL_REQUESTED,
    limit,
  )

  private fun listState(
    state: AndroidDurableExecutionState,
    limit: Int,
  ): AndroidDurableStoreListResult {
    if (limit !in 1..MAX_SCHEDULING_LIST_LIMIT || databaseHealth.isCorrupted()) {
      return AndroidDurableStoreListResult.Unavailable
    }
    return try {
      val records = buildList {
        helper.readableDatabase.query(
          RECORD_TABLE,
          RECORD_COLUMNS,
          "$COLUMN_STATE = ?",
          arrayOf(state.name),
          null,
          null,
          "$COLUMN_UPDATED_AT ASC, $COLUMN_RUN_ID ASC",
          limit.toString(),
        ).use { cursor ->
          while (cursor.moveToNext()) {
            val record = decodeCursorRecord(cursor)
              ?: return AndroidDurableStoreListResult.Unavailable
            if (record.state != state) {
              return AndroidDurableStoreListResult.Unavailable
            }
            add(record)
          }
        }
      }
      if (databaseHealth.isCorrupted()) {
        AndroidDurableStoreListResult.Unavailable
      } else {
        AndroidDurableStoreListResult.Records(records)
      }
    } catch (_: Exception) {
      AndroidDurableStoreListResult.Unavailable
    }
  }

  override fun compareAndSet(
    runId: String,
    expectedRevision: Long?,
    next: AndroidDurableExecutionRecord,
  ): AndroidDurableStoreWriteResult {
    if (
      databaseHealth.isCorrupted() ||
      next.request.identity.runId != runId ||
      !validRecord(next) ||
      expectedRevision == Long.MAX_VALUE ||
      next.revision != (expectedRevision?.plus(1) ?: 0L)
    ) {
      return AndroidDurableStoreWriteResult.UNAVAILABLE
    }

    return mutate { database ->
      when (val current = readFrom(database, runId)) {
        AndroidDurableStoreReadResult.Unavailable ->
          AndroidDurableStoreWriteResult.UNAVAILABLE
        AndroidDurableStoreReadResult.Missing -> if (expectedRevision != null) {
          AndroidDurableStoreWriteResult.CONFLICT
        } else {
          database.insertOrThrow(RECORD_TABLE, null, values(next))
          AndroidDurableStoreWriteResult.STORED
        }
        is AndroidDurableStoreReadResult.Found -> if (
          current.record.revision != expectedRevision
        ) {
          AndroidDurableStoreWriteResult.CONFLICT
        } else {
          val updated = database.update(
            RECORD_TABLE,
            values(next),
            "$COLUMN_RUN_ID = ? AND $COLUMN_REVISION = ?",
            arrayOf(runId, expectedRevision.toString()),
          )
          if (updated == 1) {
            AndroidDurableStoreWriteResult.STORED
          } else {
            AndroidDurableStoreWriteResult.CONFLICT
          }
        }
      }
    }
  }

  override fun deleteTerminal(
    runId: String,
    expectedRevision: Long,
  ): AndroidDurableStoreWriteResult = mutate { database ->
    when (val current = readFrom(database, runId)) {
      AndroidDurableStoreReadResult.Unavailable -> AndroidDurableStoreWriteResult.UNAVAILABLE
      AndroidDurableStoreReadResult.Missing -> AndroidDurableStoreWriteResult.CONFLICT
      is AndroidDurableStoreReadResult.Found -> if (
        current.record.revision != expectedRevision ||
        current.record.state !in TERMINAL_STATES
      ) {
        AndroidDurableStoreWriteResult.CONFLICT
      } else {
        val deleted = database.delete(
          RECORD_TABLE,
          "$COLUMN_RUN_ID = ? AND $COLUMN_REVISION = ?",
          arrayOf(runId, expectedRevision.toString()),
        )
        if (deleted == 1) {
          AndroidDurableStoreWriteResult.STORED
        } else {
          AndroidDurableStoreWriteResult.CONFLICT
        }
      }
    }
  }

  override fun close() {
    if (helperDelegate.isInitialized()) {
      helper.close()
    }
  }

  private fun readFrom(
    database: SQLiteDatabase,
    runId: String,
  ): AndroidDurableStoreReadResult = readSingle(
    database = database,
    selection = "$COLUMN_RUN_ID = ?",
    selectionArgs = arrayOf(runId),
    expectedRunId = runId,
  )

  private fun readSingle(
    database: SQLiteDatabase,
    selection: String,
    selectionArgs: Array<String>,
    expectedRunId: String? = null,
  ): AndroidDurableStoreReadResult {
    if (databaseHealth.isCorrupted()) {
      return AndroidDurableStoreReadResult.Unavailable
    }
    val record = try {
      database.query(
        RECORD_TABLE,
        RECORD_COLUMNS,
        selection,
        selectionArgs,
        null,
        null,
        null,
      ).use { cursor ->
        if (!cursor.moveToFirst()) {
          return AndroidDurableStoreReadResult.Missing
        }
        decodeCursorRecord(cursor)
      }
    } catch (_: Exception) {
      null
    }
    return if (databaseHealth.isCorrupted()) {
      AndroidDurableStoreReadResult.Unavailable
    } else if (
      record != null &&
      (expectedRunId == null || record.request.identity.runId == expectedRunId)
    ) {
      AndroidDurableStoreReadResult.Found(record)
    } else {
      AndroidDurableStoreReadResult.Unavailable
    }
  }

  private fun mutate(
    operation: (SQLiteDatabase) -> AndroidDurableStoreWriteResult,
  ): AndroidDurableStoreWriteResult = if (databaseHealth.isCorrupted()) {
    AndroidDurableStoreWriteResult.UNAVAILABLE
  } else try {
    val database = helper.writableDatabase
    database.beginTransaction()
    try {
      val result = if (databaseHealth.isCorrupted()) {
        AndroidDurableStoreWriteResult.UNAVAILABLE
      } else {
        operation(database)
      }
      val checkedResult = if (databaseHealth.isCorrupted()) {
        AndroidDurableStoreWriteResult.UNAVAILABLE
      } else {
        result
      }
      if (checkedResult == AndroidDurableStoreWriteResult.STORED) {
        database.setTransactionSuccessful()
      }
      checkedResult
    } finally {
      database.endTransaction()
    }
  } catch (_: SQLiteConstraintException) {
    AndroidDurableStoreWriteResult.CONFLICT
  } catch (_: SQLiteException) {
    AndroidDurableStoreWriteResult.UNAVAILABLE
  } catch (_: Exception) {
    AndroidDurableStoreWriteResult.UNAVAILABLE
  }
}

private fun decodeCursorRecord(cursor: android.database.Cursor): AndroidDurableExecutionRecord? {
  val runIdIndex = cursor.getColumnIndexOrThrow(COLUMN_RUN_ID)
  val platformWorkIdIndex = cursor.getColumnIndexOrThrow(COLUMN_PLATFORM_WORK_ID)
  val revisionIndex = cursor.getColumnIndexOrThrow(COLUMN_REVISION)
  val stateIndex = cursor.getColumnIndexOrThrow(COLUMN_STATE)
  val updatedAtIndex = cursor.getColumnIndexOrThrow(COLUMN_UPDATED_AT)
  val recordIndex = cursor.getColumnIndexOrThrow(COLUMN_RECORD)
  if (
    cursor.getType(runIdIndex) != android.database.Cursor.FIELD_TYPE_STRING ||
    cursor.getType(platformWorkIdIndex) != android.database.Cursor.FIELD_TYPE_STRING ||
    cursor.getType(revisionIndex) != android.database.Cursor.FIELD_TYPE_INTEGER ||
    cursor.getType(stateIndex) != android.database.Cursor.FIELD_TYPE_STRING ||
    cursor.getType(updatedAtIndex) != android.database.Cursor.FIELD_TYPE_INTEGER ||
    cursor.getType(recordIndex) != android.database.Cursor.FIELD_TYPE_STRING
  ) {
    return null
  }
  val runId = cursor.getString(runIdIndex)
  val platformWorkId = cursor.getString(platformWorkIdIndex)
  val revision = cursor.getLong(revisionIndex)
  val state = cursor.getString(stateIndex)
  val updatedAtMillis = cursor.getLong(updatedAtIndex)
  val decoded = decodeRecord(JSONObject(cursor.getString(recordIndex)))
  return decoded?.takeIf {
    it.request.identity.runId == runId &&
      it.platformWorkId == platformWorkId &&
      it.revision == revision &&
      it.state.name == state &&
      it.updatedAtMillis == updatedAtMillis
  }
}

private fun values(record: AndroidDurableExecutionRecord) = ContentValues().apply {
  put(COLUMN_RUN_ID, record.request.identity.runId)
  put(COLUMN_PLATFORM_WORK_ID, record.platformWorkId)
  put(COLUMN_REVISION, record.revision)
  put(COLUMN_STATE, record.state.name)
  put(COLUMN_UPDATED_AT, record.updatedAtMillis)
  put(COLUMN_RECORD, encodeRecord(record).toString())
}

private class DurableDatabaseHelper(
  context: Context,
  databaseHealth: DurableDatabaseHealth,
) : SQLiteOpenHelper(
  NoBackupDatabaseContext(context, databaseHealth.errorHandler),
  ANDROID_DURABLE_DATABASE_NAME,
  null,
  DATABASE_SCHEMA_VERSION,
  databaseHealth.errorHandler,
) {
  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onCreate(database: SQLiteDatabase) {
    database.execSQL(
      """
      CREATE TABLE $RECORD_TABLE (
        $COLUMN_RUN_ID TEXT PRIMARY KEY NOT NULL,
        $COLUMN_PLATFORM_WORK_ID TEXT NOT NULL UNIQUE,
        $COLUMN_REVISION INTEGER NOT NULL CHECK ($COLUMN_REVISION >= 0),
        $COLUMN_STATE TEXT NOT NULL,
        $COLUMN_UPDATED_AT INTEGER NOT NULL CHECK ($COLUMN_UPDATED_AT >= 0),
        $COLUMN_RECORD TEXT NOT NULL
      ) WITHOUT ROWID
      """.trimIndent(),
    )
    database.execSQL(
      "CREATE INDEX durable_execution_terminal_age " +
        "ON $RECORD_TABLE ($COLUMN_STATE, $COLUMN_UPDATED_AT)",
    )
  }

  override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    throw SQLiteException("Unsupported durable database schema $oldVersion -> $newVersion")
  }

  override fun onDowngrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    throw SQLiteException("Unsupported durable database schema $oldVersion -> $newVersion")
  }
}

private class NoBackupDatabaseContext(
  base: Context,
  private val corruptionHandler: DatabaseErrorHandler,
) : ContextWrapper(base) {
  private val databaseFile = File(noBackupFilesDir, ANDROID_DURABLE_DATABASE_NAME).also { file ->
    check(file.parentFile?.canonicalFile == noBackupFilesDir.canonicalFile)
    check(file.parentFile?.isDirectory == true || file.parentFile?.mkdirs() == true)
  }

  override fun getDatabasePath(name: String): File {
    requireDatabaseName(name)
    return databaseFile
  }

  override fun openOrCreateDatabase(
    name: String,
    mode: Int,
    factory: SQLiteDatabase.CursorFactory?,
  ): SQLiteDatabase = openDatabase(name, mode, factory, corruptionHandler)

  override fun openOrCreateDatabase(
    name: String,
    mode: Int,
    factory: SQLiteDatabase.CursorFactory?,
    errorHandler: DatabaseErrorHandler?,
  ): SQLiteDatabase = openDatabase(
    name,
    mode,
    factory,
    errorHandler ?: corruptionHandler,
  )

  override fun deleteDatabase(name: String): Boolean {
    requireDatabaseName(name)
    return SQLiteDatabase.deleteDatabase(databaseFile)
  }

  private fun openDatabase(
    name: String,
    mode: Int,
    factory: SQLiteDatabase.CursorFactory?,
    errorHandler: DatabaseErrorHandler,
  ): SQLiteDatabase {
    requireDatabaseName(name)
    var flags = SQLiteDatabase.CREATE_IF_NECESSARY
    if (mode and MODE_ENABLE_WRITE_AHEAD_LOGGING != 0) {
      flags = flags or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING
    }
    if (mode and MODE_NO_LOCALIZED_COLLATORS != 0) {
      flags = flags or SQLiteDatabase.NO_LOCALIZED_COLLATORS
    }
    return SQLiteDatabase.openDatabase(databaseFile.path, factory, flags, errorHandler)
  }

  private fun requireDatabaseName(name: String) {
    require(name == ANDROID_DURABLE_DATABASE_NAME) { "Unexpected durable database name" }
  }
}

private class DurableDatabaseHealth(context: Context) {
  private val corruptionMarker = File(
    context.noBackupFilesDir,
    ANDROID_DURABLE_CORRUPTION_MARKER_NAME,
  )

  val errorHandler = DatabaseErrorHandler { database ->
    PROCESS_CORRUPTED.set(true)
    try {
      corruptionMarker.parentFile?.mkdirs()
      FileOutputStream(corruptionMarker).use { output ->
        output.write("durable database corruption\n".toByteArray())
        output.fd.sync()
      }
    } catch (_: Exception) {
      // The process latch still prevents later access when the filesystem cannot persist evidence.
    }
    try {
      database.close()
    } catch (_: Exception) {
      // The durable corruption marker is authoritative; close is only best effort.
    }
  }

  fun isCorrupted(): Boolean = PROCESS_CORRUPTED.get() || try {
    corruptionMarker.exists()
  } catch (_: Exception) {
    true
  }

  private companion object {
    val PROCESS_CORRUPTED = AtomicBoolean(false)
  }
}

private val TERMINAL_STATES = setOf(
  AndroidDurableExecutionState.CANCELLED,
  AndroidDurableExecutionState.COMPLETED,
  AndroidDurableExecutionState.BLOCKED,
)

private fun encodeRecord(record: AndroidDurableExecutionRecord): JSONObject = JSONObject()
  .put("schema", RECORD_SCHEMA_VERSION)
  .put("request", encodeRequest(record.request))
  .put("scheduler_kind", record.schedulerKind.name)
  .put("unique_work_name", record.uniqueWorkName)
  .put("platform_work_id", record.platformWorkId)
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
      "platform_work_id",
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
    platformWorkId = json.strictString("platform_work_id"),
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
    !validUuid(record.platformWorkId) ||
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
        record.failureReason in RETRYABLE_FAILURE_REASONS &&
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
        record.failureReason !in RETRYABLE_FAILURE_REASONS &&
        record.receiptDigest == null
  }
}

private fun validUuid(value: String): Boolean = try {
  UUID.fromString(value).toString() == value
} catch (_: IllegalArgumentException) {
  false
}

private fun AndroidDurableExecutionRecord.hasNoOutcome(): Boolean =
  nextAttemptAtMillis == null && failureReason == null && receiptDigest == null

private val RETRYABLE_FAILURE_REASONS = setOf(
  AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
  AndroidDurableFailureReason.REMOTE_STILL_PENDING,
  AndroidDurableFailureReason.PROVIDER_TEMPORARILY_UNAVAILABLE,
)

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
