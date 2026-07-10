package com.kavi.mobile.durability

import androidx.work.Data
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDurableCandidateWakeRunnerTest {
  @Test
  fun `input parser accepts only the exact continuation identity`() {
    val exact = input()

    assertEquals(
      AndroidDurableCandidateWakeInput(WAKE_WORK_ID, PREDECESSOR_WORK_ID, RUN_ID),
      AndroidDurableCandidateWakeInput.parse(exact, WAKE_WORK_ID),
    )
    assertNull(
      AndroidDurableCandidateWakeInput.parse(
        Data.Builder().putAll(exact).putBoolean("unexpected", true).build(),
        WAKE_WORK_ID,
      ),
    )
    assertNull(AndroidDurableCandidateWakeInput.parse(exact, OTHER_WORK_ID))
    assertNull(
      AndroidDurableCandidateWakeInput.parse(
        Data.Builder()
          .putAll(exact)
          .putString(ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY, "run\ninvalid")
          .build(),
        WAKE_WORK_ID,
      ),
    )
  }

  @Test
  fun `tracker accepts one exact acknowledgement and consumes it once`() {
    val tracker = AndroidDurableCandidateWakeTracker()

    assertTrue(tracker.start(WAKE_WORK_ID, PREDECESSOR_WORK_ID, RUN_ID))
    assertFalse(
      tracker.acknowledge(
        WAKE_WORK_ID,
        PREDECESSOR_WORK_ID,
        "other-run",
        AndroidDurableCandidateWakeOutcome.COMPLETED,
      ),
    )
    assertTrue(
      tracker.acknowledge(
        WAKE_WORK_ID,
        PREDECESSOR_WORK_ID,
        RUN_ID,
        AndroidDurableCandidateWakeOutcome.COMPLETED,
      ),
    )
    assertFalse(
      tracker.acknowledge(
        WAKE_WORK_ID,
        PREDECESSOR_WORK_ID,
        RUN_ID,
        AndroidDurableCandidateWakeOutcome.RETRY,
      ),
    )
    assertEquals(
      AndroidDurableCandidateWakeOutcome.COMPLETED,
      tracker.consume(WAKE_WORK_ID, RUN_ID),
    )
    assertNull(tracker.consume(WAKE_WORK_ID, RUN_ID))
  }

  @Test
  fun `finished headless task succeeds only with its exact acknowledgement`() = runBlocking {
    val tracker = AndroidDurableCandidateWakeTracker()
    val runner = AndroidDurableCandidateWakeRunner(
      dispatcher = AndroidDurableCandidateHeadlessDispatcher { payload ->
        assertEquals(WAKE_WORK_ID, payload.wakeWorkId)
        assertTrue(
          tracker.acknowledge(
            payload.wakeWorkId,
            payload.predecessorWorkId,
            payload.runId,
            AndroidDurableCandidateWakeOutcome.COMPLETED,
          ),
        )
        AndroidDurableHeadlessDispatchResult.FINISHED
      },
      tracker = tracker,
    )

    assertEquals(
      AndroidDurableWorkerResult.SUCCESS,
      runner.run(WAKE_WORK_ID, input(), runAttemptCount = 0),
    )
    assertFalse(
      tracker.acknowledge(
        WAKE_WORK_ID,
        PREDECESSOR_WORK_ID,
        RUN_ID,
        AndroidDurableCandidateWakeOutcome.COMPLETED,
      ),
    )
  }

  @Test
  fun `missing acknowledgement retries finitely and releases the attempt fence`() = runBlocking {
    val tracker = AndroidDurableCandidateWakeTracker()
    val runner = AndroidDurableCandidateWakeRunner(
      dispatcher = AndroidDurableCandidateHeadlessDispatcher {
        AndroidDurableHeadlessDispatchResult.FINISHED
      },
      tracker = tracker,
    )

    assertEquals(
      AndroidDurableWorkerResult.RETRY,
      runner.run(WAKE_WORK_ID, input(), runAttemptCount = 0),
    )
    assertEquals(
      AndroidDurableWorkerResult.FAILURE,
      runner.run(WAKE_WORK_ID, input(), runAttemptCount = 4),
    )
  }

  private fun input(): Data = Data.Builder()
    .putInt(
      ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA_KEY,
      ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA,
    )
    .putString(ANDROID_DURABLE_CANDIDATE_INPUT_WAKE_ID_KEY, WAKE_WORK_ID)
    .putString(
      ANDROID_DURABLE_CANDIDATE_INPUT_PREDECESSOR_ID_KEY,
      PREDECESSOR_WORK_ID,
    )
    .putString(ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY, RUN_ID)
    .build()

  private companion object {
    const val RUN_ID = "run-candidate"
    const val WAKE_WORK_ID = "00000000-0000-4000-8000-000000000051"
    const val PREDECESSOR_WORK_ID = "00000000-0000-4000-8000-000000000052"
    const val OTHER_WORK_ID = "00000000-0000-4000-8000-000000000053"
  }
}
