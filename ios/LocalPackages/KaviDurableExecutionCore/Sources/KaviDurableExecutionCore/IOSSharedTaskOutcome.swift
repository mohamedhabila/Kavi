public struct IOSSharedTaskOutcome: Equatable, Sendable {
  public private(set) var hadFailure = false

  public init() {}

  public mutating func record(success: Bool) {
    if !success {
      hadFailure = true
    }
  }

  public mutating func reset() {
    hadFailure = false
  }

  public func completionSuccess(lastChildSucceeded: Bool) -> Bool {
    lastChildSucceeded && !hadFailure
  }
}
