import Foundation

public final class IOSFileDurableExecutionStore: IOSDurableExecutionStore, @unchecked Sendable {
  private struct Envelope: Codable {
    let schema: Int
    var records: [String: IOSDurableExecutionRecord]
  }

  private let fileURL: URL
  private let fileManager: FileManager
  private let maximumRecordCount: Int
  private let lock = NSLock()
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(
    directoryURL: URL,
    fileManager: FileManager = .default,
    maximumRecordCount: Int = 1_000
  ) {
    precondition(maximumRecordCount >= 1 && maximumRecordCount <= 1_000)
    fileURL = directoryURL.appendingPathComponent("kavi-durable-execution-v1.json")
    self.fileManager = fileManager
    self.maximumRecordCount = maximumRecordCount
    encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    decoder = JSONDecoder()
  }

  public func read(runId: String) -> IOSDurableStoreReadResult {
    withLock {
      guard IOSDurableExecutionPolicy.isValidIdentifier(runId) else { return .unavailable }
      switch loadEnvelope() {
      case .success(let envelope):
        return envelope.records[runId].map(IOSDurableStoreReadResult.found) ?? .missing
      case .failure:
        return .unavailable
      }
    }
  }

  public func list(
    query: IOSDurableStoreQuery,
    limit: Int
  ) -> IOSDurableStoreListResult {
    withLock {
      guard limit >= 1 && limit <= 1_000 else { return .unavailable }
      switch loadEnvelope() {
      case .success(let envelope):
        let records = envelope.records.values.filter(query.matches).sorted {
          if $0.updatedAtMillis != $1.updatedAtMillis {
            return $0.updatedAtMillis < $1.updatedAtMillis
          }
          return $0.request.identity.runId < $1.request.identity.runId
        }
        return .records(Array(records.prefix(limit)))
      case .failure:
        return .unavailable
      }
    }
  }

  public func compareAndSet(
    runId: String,
    expectedRevision: Int64?,
    next: IOSDurableExecutionRecord
  ) -> IOSDurableStoreWriteResult {
    withLock {
      guard validate(next), next.request.identity.runId == runId else { return .unavailable }
      switch loadEnvelope() {
      case .failure:
        return .unavailable
      case .success(var envelope):
        let existing = envelope.records[runId]
        if let expectedRevision {
          guard existing?.revision == expectedRevision else { return .conflict }
        } else if existing != nil {
          return .conflict
        }
        guard existing != nil || envelope.records.count < maximumRecordCount else {
          return .unavailable
        }
        guard next.revision == (existing?.revision ?? -1) + 1 else { return .conflict }
        envelope.records[runId] = next
        return persist(envelope) ? .stored : .unavailable
      }
    }
  }

  public func deleteTerminal(
    runId: String,
    expectedRevision: Int64
  ) -> IOSDurableStoreWriteResult {
    withLock {
      switch loadEnvelope() {
      case .failure:
        return .unavailable
      case .success(var envelope):
        guard let existing = envelope.records[runId],
          existing.revision == expectedRevision,
          existing.state.isTerminal
        else {
          return .conflict
        }
        envelope.records.removeValue(forKey: runId)
        return persist(envelope) ? .stored : .unavailable
      }
    }
  }

  private enum LoadFailure: Error {
    case unavailable
  }

  private func loadEnvelope() -> Result<Envelope, LoadFailure> {
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return .success(Envelope(schema: iosDurableBridgeSchema, records: [:]))
    }
    do {
      let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
      let envelope = try decoder.decode(Envelope.self, from: data)
      guard envelope.schema == iosDurableBridgeSchema,
        envelope.records.count <= maximumRecordCount,
        envelope.records.allSatisfy({ key, record in
          key == record.request.identity.runId && validate(record)
        })
      else {
        return .failure(.unavailable)
      }
      return .success(envelope)
    } catch {
      return .failure(.unavailable)
    }
  }

  private func persist(_ envelope: Envelope) -> Bool {
    do {
      let directory = fileURL.deletingLastPathComponent()
      try fileManager.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: nil
      )
      let data = try encoder.encode(envelope)
      try data.write(
        to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var mutableURL = fileURL
      try mutableURL.setResourceValues(values)
      return true
    } catch {
      return false
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
      && request.requestedAtMillis >= 0
      && request.constraints.earliestStartAtMillis >= request.requestedAtMillis
      && request.retryPolicy.maxAttempts >= 1
      && request.retryPolicy.maxAttempts <= IOSDurableExecutionPolicy.maximumAttempts
      && request.retryPolicy.initialBackoffMillis >= IOSDurableExecutionPolicy.minimumBackoffMillis
      && request.retryPolicy.initialBackoffMillis <= IOSDurableExecutionPolicy.maximumBackoffMillis
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
