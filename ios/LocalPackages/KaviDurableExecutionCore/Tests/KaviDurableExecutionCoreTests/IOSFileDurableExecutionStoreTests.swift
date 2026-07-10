import Foundation
import XCTest

@testable import KaviDurableExecutionCore

final class IOSFileDurableExecutionStoreTests: XCTestCase {
  func testPersistsExactRecordAcrossStoreRelaunch() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSFileDurableExecutionStore(directoryURL: directory)
    let record = initialRecord()
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: record),
      .stored
    )

    let reopened = IOSFileDurableExecutionStore(directoryURL: directory)
    guard case .found(let persisted) = reopened.read(runId: "run-1") else {
      return XCTFail("Persisted record missing")
    }
    XCTAssertEqual(persisted, record)
    let values =
      try directory
      .appendingPathComponent("kavi-durable-execution-v1.json")
      .resourceValues(forKeys: [.isExcludedFromBackupKey])
    XCTAssertEqual(values.isExcludedFromBackup, true)
  }

  func testCompareAndSetSerializesConcurrentWriters() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSFileDurableExecutionStore(directoryURL: directory)
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

  func testCorruptionFailsClosedWithoutOverwritingEvidence() throws {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    let file = directory.appendingPathComponent("kavi-durable-execution-v1.json")
    let corrupted = Data("{\"schema\":1,\"records\":BROKEN}".utf8)
    try corrupted.write(to: file)
    let store = IOSFileDurableExecutionStore(directoryURL: directory)

    guard case .unavailable = store.read(runId: "run-1") else {
      return XCTFail("Corrupted store must be unavailable")
    }
    XCTAssertEqual(
      store.compareAndSet(
        runId: "run-1",
        expectedRevision: nil,
        next: initialRecord()
      ),
      .unavailable
    )
    XCTAssertEqual(try Data(contentsOf: file), corrupted)
  }

  func testDeletesOnlyExactTerminalRevision() {
    let directory = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = IOSFileDurableExecutionStore(directoryURL: directory)
    let active = initialRecord()
    XCTAssertEqual(
      store.compareAndSet(runId: "run-1", expectedRevision: nil, next: active),
      .stored
    )
    XCTAssertEqual(store.deleteTerminal(runId: "run-1", expectedRevision: 0), .conflict)
    let terminal = active.next(state: .completed, updatedAtMillis: 2_000)
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

  private func initialRecord(
    taskIdentifier: String = "com.kavi.test.continued.run-1"
  ) -> IOSDurableExecutionRecord {
    IOSDurableExecutionRecord(
      request: durableRequest(),
      schedulerKind: .continuedProcessing,
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
