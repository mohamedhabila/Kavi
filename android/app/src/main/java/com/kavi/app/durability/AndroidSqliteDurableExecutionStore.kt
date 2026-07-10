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
import java.util.concurrent.atomic.AtomicBoolean

internal const val ANDROID_DURABLE_DATABASE_NAME = "kavi_android_durable_execution_v1.db"
internal const val ANDROID_DURABLE_CORRUPTION_MARKER_NAME =
  "kavi_android_durable_execution_v1.corrupt"
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
    !AndroidDurableExecutionRecordCodec.isValidPlatformWorkId(platformWorkId) ||
      databaseHealth.isCorrupted()
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
      !AndroidDurableExecutionRecordCodec.isValid(next) ||
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
  val decoded = AndroidDurableExecutionRecordCodec.decode(cursor.getString(recordIndex))
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
  put(COLUMN_RECORD, AndroidDurableExecutionRecordCodec.encode(record))
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
