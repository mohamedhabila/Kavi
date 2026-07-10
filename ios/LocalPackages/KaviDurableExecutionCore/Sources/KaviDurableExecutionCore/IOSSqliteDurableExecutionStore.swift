import Foundation
import SQLite3

private let iosSQLiteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public final class IOSSqliteDurableExecutionStore: IOSDurableExecutionStore, @unchecked Sendable {
  private static let schemaVersion: Int32 = 1
  private static let databaseName = "kavi-durable-execution-v1.sqlite3"

  private enum SQLiteValue {
    case blob(Data)
    case integer(Int64)
    case null
    case text(String)
  }

  private struct PersistedRow {
    let runId: String
    let revision: Int64
    let state: String
    let schedulerKind: String
    let taskIdentifier: String
    let nextAttemptAtMillis: Int64?
    let earliestStartAtMillis: Int64
    let updatedAtMillis: Int64
    let recordData: Data
  }

  private enum RowRead {
    case found(PersistedRow)
    case missing
    case unavailable
  }

  private let databaseURL: URL
  private let fileManager: FileManager
  private let maximumRecordCount: Int
  private let lock = NSLock()
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder
  private var database: OpaquePointer?
  private var available = false

  public init(
    directoryURL: URL,
    fileManager: FileManager = .default,
    maximumRecordCount: Int = 1_000
  ) {
    precondition(maximumRecordCount >= 1 && maximumRecordCount <= 1_000)
    databaseURL = directoryURL.appendingPathComponent(Self.databaseName)
    self.fileManager = fileManager
    self.maximumRecordCount = maximumRecordCount
    encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    decoder = JSONDecoder()
    available = openDatabase()
  }

  deinit {
    if let database {
      sqlite3_close_v2(database)
    }
  }

  public func read(runId: String) -> IOSDurableStoreReadResult {
    withLock {
      guard available, IOSDurableExecutionPolicy.isValidIdentifier(runId) else {
        return .unavailable
      }
      switch readRow(runId: runId) {
      case .missing:
        return .missing
      case .unavailable:
        return .unavailable
      case .found(let row):
        guard let record = decode(row) else { return .unavailable }
        return .found(record)
      }
    }
  }

  public func list(
    query: IOSDurableStoreQuery,
    limit: Int
  ) -> IOSDurableStoreListResult {
    withLock {
      guard available, limit >= 1 && limit <= 1_000 else { return .unavailable }
      if query.states?.isEmpty == true { return .records([]) }

      var clauses: [String] = []
      var values: [SQLiteValue] = []
      if let states = query.states {
        let ordered = states.map(\.rawValue).sorted()
        clauses.append("state IN (\(ordered.map { _ in "?" }.joined(separator: ",")))")
        values.append(contentsOf: ordered.map(SQLiteValue.text))
      }
      if let schedulerKind = query.schedulerKind {
        clauses.append("scheduler_kind = ?")
        values.append(.text(schedulerKind.rawValue))
      }
      if let taskIdentifier = query.taskIdentifier {
        clauses.append("task_identifier = ?")
        values.append(.text(taskIdentifier))
      }
      if let excludingRunId = query.excludingRunId {
        clauses.append("run_id != ?")
        values.append(.text(excludingRunId))
      }
      if let nextAttemptAt = query.nextAttemptAtOrBeforeMillis {
        clauses.append("next_attempt_at_millis IS NOT NULL AND next_attempt_at_millis <= ?")
        values.append(.integer(nextAttemptAt))
      }
      if let earliestStartAt = query.earliestStartAtOrBeforeMillis {
        clauses.append("earliest_start_at_millis <= ?")
        values.append(.integer(earliestStartAt))
      }

      let whereClause = clauses.isEmpty ? "" : " WHERE " + clauses.joined(separator: " AND ")
      let sql = Self.rowSelect + whereClause + " ORDER BY updated_at_millis ASC, run_id ASC"
      guard let statement = prepare(sql, values: values) else { return .unavailable }
      defer { sqlite3_finalize(statement) }

      var records: [IOSDurableExecutionRecord] = []
      while records.count < limit {
        let result = sqlite3_step(statement)
        if result == SQLITE_DONE { return .records(records) }
        guard result == SQLITE_ROW else { return .unavailable }
        guard let row = decodeCurrentRow(statement), let record = decode(row) else {
          // A malformed row is isolated to its run; other durable work remains recoverable.
          continue
        }
        records.append(record)
      }
      return .records(records)
    }
  }

  public func compareAndSet(
    runId: String,
    expectedRevision: Int64?,
    next: IOSDurableExecutionRecord
  ) -> IOSDurableStoreWriteResult {
    withLock {
      guard available, validate(next), next.request.identity.runId == runId,
        let recordData = try? encoder.encode(next), beginImmediate()
      else {
        return .unavailable
      }
      var committed = false
      defer {
        if !committed { _ = execute("ROLLBACK") }
      }

      let existing = readRow(runId: runId)
      switch (existing, expectedRevision) {
      case (.unavailable, _):
        return .unavailable
      case (.missing, .some):
        return .conflict
      case (.found, .none):
        return .conflict
      case (.missing, .none):
        guard next.revision == 0, recordCount() < maximumRecordCount else {
          return next.revision == 0 ? .unavailable : .conflict
        }
        guard insert(next, data: recordData) else { return .unavailable }
      case (.found(let row), .some(let revision)):
        guard decode(row) != nil else { return .unavailable }
        guard row.revision == revision, next.revision == revision + 1 else { return .conflict }
        guard update(next, data: recordData, expectedRevision: revision) else {
          return .conflict
        }
      }

      guard execute("COMMIT") else { return .unavailable }
      committed = true
      protectDatabaseFiles()
      return .stored
    }
  }

  public func deleteTerminal(
    runId: String,
    expectedRevision: Int64
  ) -> IOSDurableStoreWriteResult {
    withLock {
      guard available, beginImmediate() else { return .unavailable }
      var committed = false
      defer {
        if !committed { _ = execute("ROLLBACK") }
      }
      guard case .found(let row) = readRow(runId: runId),
        let record = decode(row),
        record.revision == expectedRevision,
        record.state.isTerminal
      else {
        return .conflict
      }
      guard let statement = prepare(
        "DELETE FROM ios_durable_execution_records WHERE run_id = ? AND revision = ?",
        values: [.text(runId), .integer(expectedRevision)]
      ) else {
        return .unavailable
      }
      defer { sqlite3_finalize(statement) }
      guard sqlite3_step(statement) == SQLITE_DONE, sqlite3_changes(database) == 1 else {
        return .conflict
      }
      guard execute("COMMIT") else { return .unavailable }
      committed = true
      return .stored
    }
  }

  private static let rowSelect = """
    SELECT run_id, revision, state, scheduler_kind, task_identifier,
           next_attempt_at_millis, earliest_start_at_millis, updated_at_millis, record_blob
    FROM ios_durable_execution_records
    """

  private func openDatabase() -> Bool {
    do {
      try fileManager.createDirectory(
        at: databaseURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: nil
      )
    } catch {
      return false
    }
    let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
    guard sqlite3_open_v2(databaseURL.path, &database, flags, nil) == SQLITE_OK,
      sqlite3_busy_timeout(database, 5_000) == SQLITE_OK,
      execute("PRAGMA journal_mode = WAL"),
      execute("PRAGMA synchronous = FULL"),
      execute("PRAGMA foreign_keys = ON"),
      prepareSchema()
    else {
      if let database {
        sqlite3_close_v2(database)
        self.database = nil
      }
      return false
    }
    protectDatabaseFiles()
    return true
  }

  private func prepareSchema() -> Bool {
    guard let version = scalarInt("PRAGMA user_version") else { return false }
    if version == 0 {
      guard execute("""
        CREATE TABLE ios_durable_execution_records (
          run_id TEXT PRIMARY KEY NOT NULL CHECK(length(run_id) BETWEEN 1 AND 200),
          revision INTEGER NOT NULL CHECK(revision >= 0),
          state TEXT NOT NULL CHECK(state IN (
            'scheduling', 'submitted', 'running', 'retry_waiting', 'cancel_requested',
            'cancelled', 'completed', 'expired', 'blocked'
          )),
          scheduler_kind TEXT NOT NULL CHECK(scheduler_kind IN (
            'continued_processing', 'background_processing'
          )),
          task_identifier TEXT NOT NULL CHECK(length(task_identifier) BETWEEN 1 AND 200),
          next_attempt_at_millis INTEGER CHECK(
            next_attempt_at_millis IS NULL OR next_attempt_at_millis >= 0
          ),
          earliest_start_at_millis INTEGER NOT NULL CHECK(earliest_start_at_millis >= 0),
          updated_at_millis INTEGER NOT NULL CHECK(updated_at_millis >= 0),
          record_blob BLOB NOT NULL
        )
        """),
        execute("""
          CREATE INDEX ios_durable_execution_schedule
          ON ios_durable_execution_records (
            state, scheduler_kind, next_attempt_at_millis,
            earliest_start_at_millis, updated_at_millis, run_id
          )
          """),
        execute("PRAGMA user_version = \(Self.schemaVersion)")
      else {
        return false
      }
    } else if version != Self.schemaVersion {
      return false
    }
    return hasExactSchema()
  }

  private func hasExactSchema() -> Bool {
    guard let statement = prepare(
      "SELECT name, type, \"notnull\", pk FROM pragma_table_info('ios_durable_execution_records') ORDER BY cid"
    ) else {
      return false
    }
    defer { sqlite3_finalize(statement) }
    let expected: [(String, String, Int32, Int32)] = [
      ("run_id", "TEXT", 1, 1),
      ("revision", "INTEGER", 1, 0),
      ("state", "TEXT", 1, 0),
      ("scheduler_kind", "TEXT", 1, 0),
      ("task_identifier", "TEXT", 1, 0),
      ("next_attempt_at_millis", "INTEGER", 0, 0),
      ("earliest_start_at_millis", "INTEGER", 1, 0),
      ("updated_at_millis", "INTEGER", 1, 0),
      ("record_blob", "BLOB", 1, 0),
    ]
    for column in expected {
      guard sqlite3_step(statement) == SQLITE_ROW,
        columnText(statement, 0) == column.0,
        columnText(statement, 1) == column.1,
        sqlite3_column_int(statement, 2) == column.2,
        sqlite3_column_int(statement, 3) == column.3
      else {
        return false
      }
    }
    return sqlite3_step(statement) == SQLITE_DONE
  }

  private func readRow(runId: String) -> RowRead {
    guard let statement = prepare(
      Self.rowSelect + " WHERE run_id = ?",
      values: [.text(runId)]
    ) else {
      return .unavailable
    }
    defer { sqlite3_finalize(statement) }
    switch sqlite3_step(statement) {
    case SQLITE_DONE:
      return .missing
    case SQLITE_ROW:
      return decodeCurrentRow(statement).map(RowRead.found) ?? .unavailable
    default:
      return .unavailable
    }
  }

  private func decodeCurrentRow(_ statement: OpaquePointer?) -> PersistedRow? {
    guard let runId = columnText(statement, 0),
      let state = columnText(statement, 2),
      let schedulerKind = columnText(statement, 3),
      let taskIdentifier = columnText(statement, 4),
      let blob = sqlite3_column_blob(statement, 8)
    else {
      return nil
    }
    let byteCount = Int(sqlite3_column_bytes(statement, 8))
    guard byteCount > 0 else { return nil }
    return PersistedRow(
      runId: runId,
      revision: sqlite3_column_int64(statement, 1),
      state: state,
      schedulerKind: schedulerKind,
      taskIdentifier: taskIdentifier,
      nextAttemptAtMillis: sqlite3_column_type(statement, 5) == SQLITE_NULL
        ? nil : sqlite3_column_int64(statement, 5),
      earliestStartAtMillis: sqlite3_column_int64(statement, 6),
      updatedAtMillis: sqlite3_column_int64(statement, 7),
      recordData: Data(bytes: blob, count: byteCount)
    )
  }

  private func decode(_ row: PersistedRow) -> IOSDurableExecutionRecord? {
    guard let record = try? decoder.decode(IOSDurableExecutionRecord.self, from: row.recordData),
      validate(record),
      record.request.identity.runId == row.runId,
      record.revision == row.revision,
      record.state.rawValue == row.state,
      record.schedulerKind.rawValue == row.schedulerKind,
      record.taskIdentifier == row.taskIdentifier,
      record.nextAttemptAtMillis == row.nextAttemptAtMillis,
      record.request.constraints.earliestStartAtMillis == row.earliestStartAtMillis,
      record.updatedAtMillis == row.updatedAtMillis
    else {
      return nil
    }
    return record
  }

  private func insert(_ record: IOSDurableExecutionRecord, data: Data) -> Bool {
    write(
      """
      INSERT INTO ios_durable_execution_records (
        run_id, revision, state, scheduler_kind, task_identifier,
        next_attempt_at_millis, earliest_start_at_millis, updated_at_millis, record_blob
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      record: record,
      data: data
    )
  }

  private func update(
    _ record: IOSDurableExecutionRecord,
    data: Data,
    expectedRevision: Int64
  ) -> Bool {
    guard let statement = prepare("""
      UPDATE ios_durable_execution_records
      SET revision = ?, state = ?, scheduler_kind = ?, task_identifier = ?,
          next_attempt_at_millis = ?, earliest_start_at_millis = ?,
          updated_at_millis = ?, record_blob = ?
      WHERE run_id = ? AND revision = ?
      """) else {
      return false
    }
    defer { sqlite3_finalize(statement) }
    let values = recordValues(record, data: data, includeRunIdFirst: false)
      + [.text(record.request.identity.runId), .integer(expectedRevision)]
    guard bind(values, to: statement), sqlite3_step(statement) == SQLITE_DONE else {
      return false
    }
    return sqlite3_changes(database) == 1
  }

  private func write(
    _ sql: String,
    record: IOSDurableExecutionRecord,
    data: Data
  ) -> Bool {
    guard let statement = prepare(sql) else { return false }
    defer { sqlite3_finalize(statement) }
    guard bind(recordValues(record, data: data, includeRunIdFirst: true), to: statement),
      sqlite3_step(statement) == SQLITE_DONE
    else {
      return false
    }
    return sqlite3_changes(database) == 1
  }

  private func recordValues(
    _ record: IOSDurableExecutionRecord,
    data: Data,
    includeRunIdFirst: Bool
  ) -> [SQLiteValue] {
    var values: [SQLiteValue] = []
    if includeRunIdFirst { values.append(.text(record.request.identity.runId)) }
    values.append(.integer(record.revision))
    values.append(.text(record.state.rawValue))
    values.append(.text(record.schedulerKind.rawValue))
    values.append(.text(record.taskIdentifier))
    values.append(record.nextAttemptAtMillis.map(SQLiteValue.integer) ?? .null)
    values.append(.integer(record.request.constraints.earliestStartAtMillis))
    values.append(.integer(record.updatedAtMillis))
    values.append(.blob(data))
    return values
  }

  private func bind(_ values: [SQLiteValue], to statement: OpaquePointer?) -> Bool {
    for (offset, value) in values.enumerated() {
      let index = Int32(offset + 1)
      let result: Int32
      switch value {
      case .blob(let data):
        result = data.withUnsafeBytes { bytes in
          sqlite3_bind_blob(
            statement,
            index,
            bytes.baseAddress,
            Int32(bytes.count),
            iosSQLiteTransient
          )
        }
      case .integer(let integer):
        result = sqlite3_bind_int64(statement, index, integer)
      case .null:
        result = sqlite3_bind_null(statement, index)
      case .text(let text):
        result = sqlite3_bind_text(statement, index, text, -1, iosSQLiteTransient)
      }
      if result != SQLITE_OK { return false }
    }
    return true
  }

  private func prepare(
    _ sql: String,
    values: [SQLiteValue] = []
  ) -> OpaquePointer? {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
      bind(values, to: statement)
    else {
      if let statement { sqlite3_finalize(statement) }
      return nil
    }
    return statement
  }

  private func execute(_ sql: String) -> Bool {
    sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK
  }

  private func scalarInt(_ sql: String) -> Int32? {
    guard let statement = prepare(sql) else { return nil }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
    return sqlite3_column_int(statement, 0)
  }

  private func recordCount() -> Int {
    Int(scalarInt("SELECT COUNT(*) FROM ios_durable_execution_records") ?? Int32.max)
  }

  private func beginImmediate() -> Bool {
    execute("BEGIN IMMEDIATE")
  }

  private func columnText(_ statement: OpaquePointer?, _ index: Int32) -> String? {
    guard let pointer = sqlite3_column_text(statement, index) else { return nil }
    return String(cString: pointer)
  }

  private func protectDatabaseFiles() {
    for suffix in ["", "-wal", "-shm"] {
      let url = URL(fileURLWithPath: databaseURL.path + suffix)
      guard fileManager.fileExists(atPath: url.path) else { continue }
      try? fileManager.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: url.path
      )
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var mutableURL = url
      try? mutableURL.setResourceValues(values)
    }
  }

  private func validate(_ record: IOSDurableExecutionRecord) -> Bool {
    let request = record.request
    let identity = request.identity
    let schedulerDecision = IOSDurableExecutionPolicy.decide(
      request,
      capabilities: .init(
        supportsContinuedProcessing: true,
        appIsForeground: true,
        requestTimestampIsFresh: true
      )
    )
    let progressValid: Bool
    if record.progressCompleted == nil && record.progressTotal == nil {
      progressValid = true
    } else if let completed = record.progressCompleted, let total = record.progressTotal {
      progressValid = completed >= 0 && total > 0 && completed <= total
    } else {
      progressValid = false
    }
    return IOSDurableExecutionPolicy.isValid(request)
      && schedulerDecision.schedulerKind == record.schedulerKind
      && IOSDurableExecutionPolicy.isValidIdentifier(record.taskIdentifier)
      && record.attempt >= 0 && record.attempt <= request.retryPolicy.maxAttempts
      && record.revision >= 0 && record.updatedAtMillis >= request.requestedAtMillis
      && identity.snapshotUpdatedAtMillis <= record.updatedAtMillis
      && (record.nextAttemptAtMillis == nil
        || record.nextAttemptAtMillis! >= record.updatedAtMillis)
      && (record.receiptDigest == nil
        || IOSDurableExecutionPolicy.isSHA256Digest(record.receiptDigest!))
      && (record.lastCheckpointAtMillis == nil
        || (record.lastCheckpointAtMillis! >= request.requestedAtMillis
          && record.lastCheckpointAtMillis! <= record.updatedAtMillis))
      && progressValid
      && validateState(record)
  }

  private func validateState(_ record: IOSDurableExecutionRecord) -> Bool {
    switch record.state {
    case .scheduling, .submitted:
      return record.attempt == 0 && record.nextAttemptAtMillis == nil
        && record.failureReason == nil && record.receiptDigest == nil
    case .running:
      return record.attempt >= 1 && record.nextAttemptAtMillis == nil
        && record.failureReason == nil && record.receiptDigest == nil
    case .retryWaiting:
      return record.attempt >= 1 && record.nextAttemptAtMillis != nil
        && record.failureReason?.isRetryable == true && record.receiptDigest == nil
    case .cancelRequested:
      return record.receiptDigest == nil
    case .cancelled:
      return record.nextAttemptAtMillis == nil && record.failureReason == nil
        && record.receiptDigest == nil
    case .completed:
      return record.nextAttemptAtMillis == nil && record.failureReason == nil
        && record.receiptDigest != nil
    case .expired:
      let interruptionReasons: Set<IOSDurableFailureReason> = [
        .platformExpired,
        .continuedProcessingInterrupted,
        .platformRequestMissing,
      ]
      return record.nextAttemptAtMillis == nil && record.receiptDigest == nil
        && record.failureReason.map(interruptionReasons.contains) == true
    case .blocked:
      return record.nextAttemptAtMillis == nil && record.failureReason != nil
        && record.receiptDigest == nil
    }
  }

  private func withLock<T>(_ operation: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return operation()
  }
}
