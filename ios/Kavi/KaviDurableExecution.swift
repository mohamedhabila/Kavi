import Foundation
import KaviDurableExecutionCore
import React

@objc(KaviDurableExecution)
final class KaviDurableExecution: RCTEventEmitter {
  private let runtime = IOSDurableExecutionRuntime.shared

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [kaviDurableExecutionWakeEventName]
  }

  override func constantsToExport() -> [AnyHashable: Any]! {
    [
      "bridgeSchema": iosDurableBridgeSchema,
      "wakeEventName": kaviDurableExecutionWakeEventName,
      "supportsProgressCheckpoint": true,
    ]
  }

  override func startObserving() {
    runtime.setEventHandler { [weak self] event in
      DispatchQueue.main.async {
        self?.sendEvent(
          withName: kaviDurableExecutionWakeEventName,
          body: IOSDurableBridgeCodec.encodeWakeEvent(event)
        )
      }
    }
  }

  override func stopObserving() {
    runtime.setEventHandler(nil)
  }

  override func invalidate() {
    runtime.setEventHandler(nil)
    super.invalidate()
  }

  @objc
  func enqueue(
    _ request: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let request = try IOSDurableBridgeCodec.decodeRequest(request)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.enqueue(
          request,
          capabilities: self.runtime.capabilities(
            requestedAtMillis: request.requestedAtMillis
          )
        )
      )
    }
  }

  @objc
  func cancel(
    _ pointer: NSDictionary,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodePointer(pointer)
      let updatedAt = try IOSDurableBridgeCodec.decodeTimestamp(
        updatedAtMillis,
        path: "updatedAtMillis"
      )
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.cancel(
          pointer: pointer,
          updatedAtMillis: updatedAt
        )
      )
    }
  }

  @objc
  func reportProgress(
    _ pointer: NSDictionary,
    completed: NSNumber,
    total: NSNumber,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodeAttemptPointer(pointer)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.reportProgress(
          pointer: pointer,
          completed: try IOSDurableBridgeCodec.decodeTimestamp(
            completed,
            path: "completed"
          ),
          total: try IOSDurableBridgeCodec.decodeTimestamp(total, path: "total"),
          updatedAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            updatedAtMillis,
            path: "updatedAtMillis"
          )
        )
      )
    }
  }

  @objc
  func checkpoint(
    _ pointer: NSDictionary,
    nextIdentity: NSDictionary,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodeAttemptPointer(pointer)
      let nextIdentity = try IOSDurableBridgeCodec.decodeCheckpointIdentity(nextIdentity)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.checkpoint(
          pointer: pointer,
          nextIdentity: nextIdentity,
          updatedAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            updatedAtMillis,
            path: "updatedAtMillis"
          )
        )
      )
    }
  }

  @objc
  func complete(
    _ pointer: NSDictionary,
    receiptDigest: String,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodeAttemptPointer(pointer)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.complete(
          pointer: pointer,
          receiptDigest: receiptDigest,
          updatedAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            updatedAtMillis,
            path: "updatedAtMillis"
          )
        )
      )
    }
  }

  @objc
  func scheduleRetry(
    _ pointer: NSDictionary,
    nextAttemptAtMillis: NSNumber,
    failureReason: String,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodeAttemptPointer(pointer)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.scheduleRetry(
          pointer: pointer,
          nextAttemptAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            nextAttemptAtMillis,
            path: "nextAttemptAtMillis"
          ),
          failureReason: try IOSDurableBridgeCodec.decodeFailureReason(
            failureReason,
            retryable: true
          ),
          updatedAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            updatedAtMillis,
            path: "updatedAtMillis"
          )
        )
      )
    }
  }

  @objc
  func block(
    _ pointer: NSDictionary,
    failureReason: String,
    updatedAtMillis: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let pointer = try IOSDurableBridgeCodec.decodeAttemptPointer(pointer)
      return IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.block(
          pointer: pointer,
          failureReason: try IOSDurableBridgeCodec.decodeFailureReason(
            failureReason,
            retryable: false
          ),
          updatedAtMillis: try IOSDurableBridgeCodec.decodeTimestamp(
            updatedAtMillis,
            path: "updatedAtMillis"
          )
        )
      )
    }
  }

  @objc
  func releaseTerminal(
    _ pointer: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      IOSDurableBridgeCodec.encodeAdapterResult(
        self.runtime.adapter.releaseTerminal(
          pointer: try IOSDurableBridgeCodec.decodePointer(pointer)
        )
      )
    }
  }

  @objc
  func getRecord(
    _ runId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      IOSDurableBridgeCodec.encodeReadResult(
        self.runtime.store.read(
          runId: try IOSDurableBridgeCodec.decodeRunId(runId)
        )
      )
    }
  }

  @objc
  func getPendingLaunches(
    _ limit: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      IOSDurableBridgeCodec.encodePendingRecords(
        self.runtime.adapter.listPendingRecoveryRecords(
          limit: try IOSDurableBridgeCodec.decodeLimit(limit)
        )
      )
    }
  }

  @objc
  func reconcileOutboxes(
    _ limit: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    submit(resolve: resolve, reject: reject) {
      let limit = try IOSDurableBridgeCodec.decodeLimit(limit)
      return IOSDurableBridgeCodec.encodeOutboxResult(
        scheduling: self.runtime.adapter.reconcileScheduling(limit: limit),
        cancellation: self.runtime.adapter.reconcileCancellationRequests(limit: limit)
      )
    }
  }

  private func submit(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock,
    operation: @escaping () throws -> Any
  ) {
    runtime.operationQueue.async {
      do {
        resolve(try operation())
      } catch let error as IOSDurableBridgeContractError {
        reject(
          "DURABLE_EXECUTION_CONTRACT_VIOLATION",
          String(describing: error),
          error
        )
      } catch {
        reject(
          "DURABLE_EXECUTION_FAILED",
          "iOS durable execution failed.",
          error
        )
      }
    }
  }
}
