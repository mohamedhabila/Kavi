import XCTest

@testable import KaviDurableExecutionCore

final class IOSSharedTaskOutcomeTests: XCTestCase {
  func testFailureCannotBeOverwrittenByLaterSuccess() {
    var outcome = IOSSharedTaskOutcome()
    outcome.record(success: false)
    outcome.record(success: true)

    XCTAssertFalse(outcome.completionSuccess(lastChildSucceeded: true))
  }

  func testFailureOrderingAndResetAreDeterministic() {
    var outcome = IOSSharedTaskOutcome()
    outcome.record(success: true)
    outcome.record(success: false)
    XCTAssertFalse(outcome.completionSuccess(lastChildSucceeded: false))

    outcome.reset()
    XCTAssertTrue(outcome.completionSuccess(lastChildSucceeded: true))
  }
}
