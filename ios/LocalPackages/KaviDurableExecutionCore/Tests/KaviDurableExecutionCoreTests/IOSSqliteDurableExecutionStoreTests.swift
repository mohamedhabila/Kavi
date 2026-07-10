import Foundation
import SQLite3
import XCTest

@testable import KaviDurableExecutionCore

final class IOSSqliteDurableExecutionStoreTests: XCTestCase {
  func testPersistsExactRecordAcrossStoreRelaunch() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    let record = initialRecord()
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: record),
      .stored
    )

    let reopened = IOSSqliteDurableExecutionStore(directoryURL: directory)
    guard case .found(let persisted) = reopened.read(runId: "run-1") else {
      return XCTFail("Persisted record missing")
    }
    XCTAssertEqual(persisted, record)
    let values = try databaseURL(directory).resourceValues(forKeys: [.isExcludedFromBackupKey])
    XCTAssertEqual(values.isExcludedFromBackup, true)
  }

  func testCompareAndSetSerializesConcurrentWriters() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    let queue = DispatchQueue(label: "store-race", attributes: .concurrent)
    let group = DispatchGroup()
    let results = LockedResults()

    for index in 0..<20 {
      group.enter()
      queue.async {
        let result = store.compareAndSet(
          runId: "run-1",
          expectedRevision: nil,
          next: self.initialRecord(taskIdentifier: "com.kavi.test.\(index)")
        )
        results.append(result)
        group.leave()
      }
    }
    group.wait()

    XCTAssertEqual(results.values.filter { $0 == .stored }.count, 1)
    XCTAssertEqual(results.values.filter { $0 == .conflict }.count, 19)
  }

  func testMalformedRecordIsIsolatedWithoutOverwritingEvidence() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-1",
        expectedRevision: nil,
        next: initialRecord(runId: "run-1")
      ),
      .stored
    )
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-2",
        expectedRevision: nil,
        next: initialRecord(runId: "run-2")
      ),
      .stored
    )
    try executeSQL(
      at: databaseURL(directory),
      sql: "UPDATE ios_durable_execution_records SET record_blob = X'7B' WHERE run_id = 'run-1'"
    )

    guard case .unavailable = store.read(runId: "run-1") else {
      return XCTFail("Malformed row must fail closed for its exact run")
    }
    guard case .found(let healthy) = store.read(runId: "run-2") else {
      return XCTFail("Malformed row must not brick a healthy run")
    }
    XCTAssertEqual(healthy.request.identity.runId, "run-2")
    guard case .records(let listed) = store.list(query: .init(), limit: 10) else {
      return XCTFail("Malformed row must not brick list recovery")
    }
    XCTAssertEqual(listed.map(\.request.identity.runId), ["run-2"])
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-1",
        expectedRevision: 0,
        next: initialRecord(runId: "run-1").next(updatedAtMillis: 2_000)
      ),
      .unavailable
    )
    XCTAssertEqual(try scalarBlobLength(at: databaseURL(directory), runId: "run-1"), 1)
  }

  func testMetadataMismatchIsIsolatedFromFilteredQueries() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    for runId in ["run-1", "run-2"] {
      XCTAssertEqual(
        store.compareAndSet(
          runId: runId,
          expectedRevision: nil,
          next: initialRecord(runId: runId)
        ),
        .stored
      )
    }
    try executeSQL(
      at: databaseURL(directory),
      sql: "UPDATE ios_durable_execution_records SET state = 'running' WHERE run_id = 'run-1'"
    )

    guard
      case .records(let records) = store.list(
        query: .init(states: [.scheduling]),
        limit: 1
      )
    else {
      return XCTFail("Healthy rows must remain queryable")
    }
    XCTAssertEqual(records.map(\.request.identity.runId), ["run-2"])
  }

  func testRejectsUnknownSchemaWithoutCreatingFallbackStore() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try executeSQL(at: databaseURL(directory), sql: "PRAGMA user_version = 99")
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)

    guard case .unavailable = store.read(runId: "run-1") else {
      return XCTFail("Unknown schema must fail closed")
    }
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-1",
        expectedRevision: nil,
        next: initialRecord()
      ),
      .unavailable
    )
    XCTAssertEqual(try scalarInt(at: databaseURL(directory), sql: "PRAGMA user_version"), 99)
  }

  func testDeletesOnlyExactTerminalRevision() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    let active = initialRecord()
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: active),
      .stored
    )
    XCTAssertEqual(store.deleteTerminal(runId: "run-1", expectedRevision: 0), .conflict)
    let terminal = active.next(
      state: .completed,
      receiptDigest: .some(String(repeating: "e", count: 64)),
      updatedAtMillis: 2_000
    )
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: 0, next: terminal),
      .stored
    )
    XCTAssertEqual(store.deleteTerminal(runId: "run-1", expectedRevision: 0), .conflict)
    XCTAssertEqual(store.deleteTerminal(runId: "run-1", expectedRevision: 1), .stored)
    guard case .missing = store.read(runId: "run-1") else {
      return XCTFail("Terminal record was not deleted")
    }
  }

  func testCapacityIsReclaimedOnlyByExactTerminalRelease() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(
      directoryURL: directory,
      maximumRecordCount: 1
    )
    let active = initialRecord(runId: "run-1")
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: active),
      .stored
    )
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-2",
        expectedRevision: nil,
        next: initialRecord(runId: "run-2")
      ),
      .unavailable
    )
    let terminal = active.next(
      state: .completed,
      receiptDigest: .some(String(repeating: "e", count: 64)),
      updatedAtMillis: 2_000
    )
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: 0, next: terminal),
      .stored
    )
    XCTAssertEqual(store.deleteTerminal(runId: "run-1", expectedRevision: 1), .stored)
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-2",
        expectedRevision: nil,
        next: initialRecord(runId: "run-2")
      ),
      .stored
    )
  }

  func testRejectsImpossibleTerminalStateWithoutReceipt() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSSqliteDurableExecutionStore(directoryURL: directory)
    let active = initialRecord()
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: active),
      .stored
    )
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-1",
        expectedRevision: 0,
        next: active.next(state: .completed, updatedAtMillis: 2_000)
      ),
      .unavailable
    )
  }

  private func initialRecord(
    runId: String = "run-1",
    taskIdentifier: String = "com.kavi.test.processing"
  ) -> IOSDurableExecutionRecord {
    IOSDurableExecutionRecord(
      request: durableRequest(
        runId: runId,
        durabilityClass: .externalDurableOperation,
        commandKind: .reconcileExternalHandles,
        network: .connected
      ),
      schedulerKind: .backgroundProcessing,
      taskIdentifier: taskIdentifier,
      state: .scheduling,
      attempt: 0,
      nextAttemptAtMillis: nil,
      failureReason: nil,
      receiptDigest: nil,
      progressCompleted: nil,
      progressTotal: nil,
      lastCheckpointAtMillis: nil,
      revision: 0,
      updatedAtMillis: 1_000
    )
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("kavi-durable-store-tests")
      .appendingPathComponent(UUID().uuidString)
  }

  private func databaseURL(_ directory: URL) -> URL {
    directory.appendingPathComponent("kavi-durable-execution-v1.sqlite3")
  }

  private func executeSQL(at url: URL, sql: String) throws {
    var database: OpaquePointer?
    guard
      sqlite3_open_v2(url.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE, nil)
        == SQLITE_OK
    else {
      throw SQLiteTestError.open
    }
    defer { sqlite3_close_v2(database) }
    guard sqlite3_busy_timeout(database, 5_000) == SQLITE_OK,
      sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK
    else {
      throw SQLiteTestError.execute
    }
  }

  private func scalarInt(at url: URL, sql: String) throws -> Int32 {
    var database: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      throw SQLiteTestError.open
    }
    defer { sqlite3_close_v2(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
      throw SQLiteTestError.execute
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { throw SQLiteTestError.execute }
    return sqlite3_column_int(statement, 0)
  }

  private func scalarBlobLength(at url: URL, runId: String) throws -> Int32 {
    try scalarInt(
      at: url,
      sql: "SELECT length(record_blob) FROM ios_durable_execution_records WHERE run_id = '\(runId)'"
    )
  }
}

private enum SQLiteTestError: Error {
  case open
  case execute
}

private final class LockedResults: @unchecked Sendable {
  private let lock = NSLock()
  private var storage: [IOSDurableStoreWriteResult] = []

  var values: [IOSDurableStoreWriteResult] {
    lock.lock()
    defer { lock.unlock() }
    return storage
  }

  func append(_ result: IOSDurableStoreWriteResult) {
    lock.lock()
    storage.append(result)
    lock.unlock()
  }
}
