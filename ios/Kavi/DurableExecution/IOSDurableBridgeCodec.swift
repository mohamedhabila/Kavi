import CoreFoundation
import Foundation
import KaviDurableExecutionCore

let kaviDurableExecutionModuleName = "KaviDurableExecution"
let kaviDurableExecutionWakeEventName = "KaviDurableExecutionWake"

enum IOSDurableBridgeContractError: Error {
  case invalid(String)
}

enum IOSDurableBridgeCodec {
  static func decodeRequest(_ value: NSDictionary) throws -> IOSDurableExecutionRequest {
    let request = try dictionary(value, path: "request")
    try requireExactKeys(
      request,
      path: "request",
      keys: [
        "schema",
        "durabilityClass",
        "identity",
        "constraints",
        "retryPolicy",
        "requestedAtMillis",
      ]
    )
    try requireSchema(request, path: "request")
    let identity = try dictionary(request["identity"], path: "request.identity")
    try requireExactKeys(
      identity,
      path: "request.identity",
      keys: [
        "runId",
        "controlEpoch",
        "snapshotUpdatedAtMillis",
        "snapshotDigest",
        "commandKind",
        "commandDigest",
      ]
    )
    let constraints = try dictionary(request["constraints"], path: "request.constraints")
    try requireExactKeys(
      constraints,
      path: "request.constraints",
      keys: [
        "network",
        "requiresCharging",
        "requiresBatteryNotLow",
        "requiresStorageNotLow",
        "requiresDeviceIdle",
        "earliestStartAtMillis",
      ]
    )
    let retry = try dictionary(request["retryPolicy"], path: "request.retryPolicy")
    try requireExactKeys(
      retry,
      path: "request.retryPolicy",
      keys: ["maxAttempts", "backoffPolicy", "initialBackoffMillis"]
    )
    return IOSDurableExecutionRequest(
      durabilityClass: try enumeration(
        request["durabilityClass"],
        path: "request.durabilityClass"
      ),
      identity: try decodeIdentity(identity, path: "request.identity"),
      constraints: IOSExecutionConstraints(
        network: try enumeration(
          constraints["network"],
          path: "request.constraints.network"
        ),
        requiresCharging: try boolean(
          constraints["requiresCharging"],
          path: "request.constraints.requiresCharging"
        ),
        requiresBatteryNotLow: try boolean(
          constraints["requiresBatteryNotLow"],
          path: "request.constraints.requiresBatteryNotLow"
        ),
        requiresStorageNotLow: try boolean(
          constraints["requiresStorageNotLow"],
          path: "request.constraints.requiresStorageNotLow"
        ),
        requiresDeviceIdle: try boolean(
          constraints["requiresDeviceIdle"],
          path: "request.constraints.requiresDeviceIdle"
        ),
        earliestStartAtMillis: try integer(
          constraints["earliestStartAtMillis"],
          path: "request.constraints.earliestStartAtMillis"
        )
      ),
      retryPolicy: IOSRetryPolicy(
        maxAttempts: try boundedInt(
          retry["maxAttempts"],
          path: "request.retryPolicy.maxAttempts"
        ),
        backoffPolicy: try enumeration(
          retry["backoffPolicy"],
          path: "request.retryPolicy.backoffPolicy"
        ),
        initialBackoffMillis: try integer(
          retry["initialBackoffMillis"],
          path: "request.retryPolicy.initialBackoffMillis"
        )
      ),
      requestedAtMillis: try integer(
        request["requestedAtMillis"],
        path: "request.requestedAtMillis"
      )
    )
  }

  static func decodePointer(_ value: NSDictionary) throws -> IOSDurableExecutionPointer {
    let pointer = try dictionary(value, path: "pointer")
    try requireExactKeys(
      pointer,
      path: "pointer",
      keys: [
        "schema",
        "runId",
        "controlEpoch",
        "snapshotUpdatedAtMillis",
        "snapshotDigest",
        "commandDigest",
      ]
    )
    try requireSchema(pointer, path: "pointer")
    return try decodePointerBody(pointer, path: "pointer")
  }

  static func decodeAttemptPointer(
    _ value: NSDictionary
  ) throws -> IOSDurableExecutionAttemptPointer {
    let pointer = try dictionary(value, path: "attemptPointer")
    try requireExactKeys(
      pointer,
      path: "attemptPointer",
      keys: ["schema", "generation", "attempt"]
    )
    try requireSchema(pointer, path: "attemptPointer")
    let generation = try dictionary(
      pointer["generation"],
      path: "attemptPointer.generation"
    )
    try requireExactKeys(
      generation,
      path: "attemptPointer.generation",
      keys: [
        "runId",
        "controlEpoch",
        "snapshotUpdatedAtMillis",
        "snapshotDigest",
        "commandDigest",
      ]
    )
    return IOSDurableExecutionAttemptPointer(
      generation: try decodePointerBody(
        generation,
        path: "attemptPointer.generation"
      ),
      attempt: try boundedInt(pointer["attempt"], path: "attemptPointer.attempt")
    )
  }

  static func decodeCheckpointIdentity(
    _ value: NSDictionary
  ) throws -> IOSRecoveryCommandIdentity {
    let identity = try dictionary(value, path: "checkpointIdentity")
    try requireExactKeys(
      identity,
      path: "checkpointIdentity",
      keys: [
        "schema",
        "runId",
        "controlEpoch",
        "snapshotUpdatedAtMillis",
        "snapshotDigest",
        "commandKind",
        "commandDigest",
      ]
    )
    try requireSchema(identity, path: "checkpointIdentity")
    return try decodeIdentity(identity, path: "checkpointIdentity")
  }

  static func decodeTimestamp(_ value: NSNumber, path: String) throws -> Int64 {
    try integer(value, path: path)
  }

  static func decodeLimit(_ value: NSNumber) throws -> Int {
    let limit = try boundedInt(value, path: "limit")
    guard limit >= 1 && limit <= 1_000 else {
      throw IOSDurableBridgeContractError.invalid("limit is outside the supported range")
    }
    return limit
  }

  static func decodeRunId(_ value: String) throws -> String {
    guard IOSDurableExecutionPolicy.isValidIdentifier(value) else {
      throw IOSDurableBridgeContractError.invalid("runId is invalid")
    }
    return value
  }

  static func decodeFailureReason(
    _ value: String,
    retryable: Bool
  ) throws -> IOSDurableFailureReason {
    guard let reason = IOSDurableFailureReason(rawValue: value) else {
      throw IOSDurableBridgeContractError.invalid("failure reason is unsupported")
    }
    let allowedBlockReasons: Set<IOSDurableFailureReason> = [
      .generationChanged,
      .authorityChanged,
      .handlerRejected,
      .handlerFailed,
    ]
    guard retryable ? reason.isRetryable : allowedBlockReasons.contains(reason) else {
      throw IOSDurableBridgeContractError.invalid("failure reason is unsupported")
    }
    return reason
  }

  static func encodeAdapterResult(_ result: IOSDurableAdapterResult) -> [String: Any] {
    var output: [String: Any] = ["schema": iosDurableBridgeSchema]
    switch result {
    case .accepted(let record):
      output.merge(["status": "accepted", "reason": NSNull(), "record": encodeRecord(record)]) {
        _, new in new
      }
    case .noOp(let record):
      output.merge(["status": "no_op", "reason": NSNull(), "record": encodeRecord(record)]) {
        _, new in new
      }
    case .released(let record):
      output.merge(["status": "released", "reason": NSNull(), "record": encodeRecord(record)]) {
        _, new in new
      }
    case .unsupported(let reason):
      output.merge(["status": "unsupported", "reason": reason.rawValue, "record": NSNull()]) {
        _, new in new
      }
    case .rejected(let reason):
      output.merge(["status": "rejected", "reason": reason.rawValue, "record": NSNull()]) {
        _, new in new
      }
    case .deferred(let reason):
      output.merge(["status": "deferred", "reason": reason.rawValue, "record": NSNull()]) {
        _, new in new
      }
    }
    return output
  }

  static func encodeReadResult(_ result: IOSDurableStoreReadResult) -> [String: Any] {
    switch result {
    case .found(let record):
      return [
        "schema": iosDurableBridgeSchema,
        "status": "found",
        "record": encodeRecord(record),
      ]
    case .missing:
      return ["schema": iosDurableBridgeSchema, "status": "missing", "record": NSNull()]
    case .unavailable:
      return ["schema": iosDurableBridgeSchema, "status": "unavailable", "record": NSNull()]
    }
  }

  static func encodeWakeEvent(_ event: IOSDurableWakeEvent) -> [String: Any] {
    [
      "schema": iosDurableBridgeSchema,
      "trigger": event.trigger.rawValue,
      "disposition": event.disposition.rawValue,
      "record": encodeRecord(event.record),
    ]
  }

  static func encodePendingRecords(_ result: IOSDurableStoreListResult) -> [String: Any] {
    switch result {
    case .unavailable:
      return ["schema": iosDurableBridgeSchema, "status": "unavailable", "events": []]
    case .records(let records):
      return [
        "schema": iosDurableBridgeSchema,
        "status": "available",
        "events": records.map {
          return encodeWakeEvent(
            .init(
              trigger: .relaunchReconciliation,
              disposition: iosDurableWakeDisposition(for: $0),
              record: $0
            )
          )
        },
      ]
    }
  }

  static func encodeOutboxResult(
    scheduling: IOSDurableOutboxResult,
    cancellation: IOSDurableOutboxResult
  ) -> [String: Any] {
    [
      "schema": iosDurableBridgeSchema,
      "scheduling": encodeOutboxSide(scheduling),
      "cancellation": encodeOutboxSide(cancellation),
    ]
  }

  private static func encodeOutboxSide(_ result: IOSDurableOutboxResult) -> [String: Any] {
    switch result {
    case .storeUnavailable:
      return ["status": "store_unavailable", "outcomes": []]
    case .completed(let outcomes):
      return [
        "status": "completed",
        "outcomes": outcomes.map {
          [
            "runId": $0.runId,
            "result": encodeAdapterResult($0.result),
          ]
        },
      ]
    }
  }

  private static func encodeRecord(_ record: IOSDurableExecutionRecord) -> [String: Any] {
    [
      "request": encodeRequest(record.request),
      "schedulerKind": record.schedulerKind.rawValue,
      "taskIdentifier": record.taskIdentifier,
      "state": record.state.rawValue,
      "attempt": record.attempt,
      "nextAttemptAtMillis": bridgeValue(record.nextAttemptAtMillis),
      "failureReason": bridgeValue(record.failureReason?.rawValue),
      "receiptDigest": bridgeValue(record.receiptDigest),
      "progressCompleted": bridgeValue(record.progressCompleted),
      "progressTotal": bridgeValue(record.progressTotal),
      "lastCheckpointAtMillis": bridgeValue(record.lastCheckpointAtMillis),
      "revision": record.revision,
      "updatedAtMillis": record.updatedAtMillis,
    ]
  }

  private static func encodeRequest(_ request: IOSDurableExecutionRequest) -> [String: Any] {
    [
      "schema": iosDurableBridgeSchema,
      "durabilityClass": request.durabilityClass.rawValue,
      "identity": [
        "runId": request.identity.runId,
        "controlEpoch": request.identity.controlEpoch,
        "snapshotUpdatedAtMillis": request.identity.snapshotUpdatedAtMillis,
        "snapshotDigest": request.identity.snapshotDigest,
        "commandKind": request.identity.commandKind.rawValue,
        "commandDigest": request.identity.commandDigest,
      ],
      "constraints": [
        "network": request.constraints.network.rawValue,
        "requiresCharging": request.constraints.requiresCharging,
        "requiresBatteryNotLow": request.constraints.requiresBatteryNotLow,
        "requiresStorageNotLow": request.constraints.requiresStorageNotLow,
        "requiresDeviceIdle": request.constraints.requiresDeviceIdle,
        "earliestStartAtMillis": request.constraints.earliestStartAtMillis,
      ],
      "retryPolicy": [
        "maxAttempts": request.retryPolicy.maxAttempts,
        "backoffPolicy": request.retryPolicy.backoffPolicy.rawValue,
        "initialBackoffMillis": request.retryPolicy.initialBackoffMillis,
      ],
      "requestedAtMillis": request.requestedAtMillis,
    ]
  }

  private static func decodeIdentity(
    _ identity: [String: Any],
    path: String
  ) throws -> IOSRecoveryCommandIdentity {
    IOSRecoveryCommandIdentity(
      runId: try string(identity["runId"], path: "\(path).runId"),
      controlEpoch: try integer(identity["controlEpoch"], path: "\(path).controlEpoch"),
      snapshotUpdatedAtMillis: try integer(
        identity["snapshotUpdatedAtMillis"],
        path: "\(path).snapshotUpdatedAtMillis"
      ),
      snapshotDigest: try string(
        identity["snapshotDigest"],
        path: "\(path).snapshotDigest"
      ),
      commandKind: try enumeration(identity["commandKind"], path: "\(path).commandKind"),
      commandDigest: try string(
        identity["commandDigest"],
        path: "\(path).commandDigest"
      )
    )
  }

  private static func decodePointerBody(
    _ pointer: [String: Any],
    path: String
  ) throws -> IOSDurableExecutionPointer {
    IOSDurableExecutionPointer(
      runId: try string(pointer["runId"], path: "\(path).runId"),
      controlEpoch: try integer(pointer["controlEpoch"], path: "\(path).controlEpoch"),
      snapshotUpdatedAtMillis: try integer(
        pointer["snapshotUpdatedAtMillis"],
        path: "\(path).snapshotUpdatedAtMillis"
      ),
      snapshotDigest: try string(
        pointer["snapshotDigest"],
        path: "\(path).snapshotDigest"
      ),
      commandDigest: try string(
        pointer["commandDigest"],
        path: "\(path).commandDigest"
      )
    )
  }

  private static func requireSchema(
    _ value: [String: Any],
    path: String
  ) throws {
    guard try boundedInt(value["schema"], path: "\(path).schema") == iosDurableBridgeSchema else {
      throw IOSDurableBridgeContractError.invalid("\(path) schema is unsupported")
    }
  }

  private static func requireExactKeys(
    _ value: [String: Any],
    path: String,
    keys: Set<String>
  ) throws {
    guard Set(value.keys) == keys else {
      throw IOSDurableBridgeContractError.invalid("\(path) has an invalid shape")
    }
  }

  private static func dictionary(_ value: Any?, path: String) throws -> [String: Any] {
    guard let dictionary = value as? NSDictionary else {
      throw IOSDurableBridgeContractError.invalid("\(path) must be an object")
    }
    var output: [String: Any] = [:]
    for (key, value) in dictionary {
      guard let key = key as? String else {
        throw IOSDurableBridgeContractError.invalid("\(path) has a non-string key")
      }
      output[key] = value
    }
    return output
  }

  private static func string(_ value: Any?, path: String) throws -> String {
    guard let value = value as? String else {
      throw IOSDurableBridgeContractError.invalid("\(path) must be a string")
    }
    return value
  }

  private static func boolean(_ value: Any?, path: String) throws -> Bool {
    guard let value = value as? NSNumber,
      CFGetTypeID(value) == CFBooleanGetTypeID()
    else {
      throw IOSDurableBridgeContractError.invalid("\(path) must be a boolean")
    }
    return value.boolValue
  }

  private static func integer(_ value: Any?, path: String) throws -> Int64 {
    guard let value = value as? NSNumber,
      CFGetTypeID(value) != CFBooleanGetTypeID(),
      value.doubleValue.isFinite,
      value.doubleValue.rounded(.towardZero) == value.doubleValue,
      abs(value.doubleValue) <= 9_007_199_254_740_991
    else {
      throw IOSDurableBridgeContractError.invalid("\(path) must be a safe integer")
    }
    return value.int64Value
  }

  private static func boundedInt(_ value: Any?, path: String) throws -> Int {
    let value = try integer(value, path: path)
    guard value >= Int64(Int.min), value <= Int64(Int.max) else {
      throw IOSDurableBridgeContractError.invalid("\(path) is outside the integer range")
    }
    return Int(value)
  }

  private static func enumeration<T: RawRepresentable>(
    _ value: Any?,
    path: String
  ) throws -> T where T.RawValue == String {
    let rawValue = try string(value, path: path)
    guard let value = T(rawValue: rawValue) else {
      throw IOSDurableBridgeContractError.invalid("\(path) is unsupported")
    }
    return value
  }

  private static func bridgeValue<T>(_ value: T?) -> Any {
    if let value { return value }
    return NSNull()
  }
}
