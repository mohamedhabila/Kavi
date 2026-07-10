package com.kavi.mobile.durability

import androidx.work.Data
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal const val ANDROID_DURABLE_CANDIDATE_TASK_KEY = "KaviDurableCandidateSchedule"
internal const val ANDROID_DURABLE_CANDIDATE_WORK_TAG = "kavi.durable-candidate.v1"
internal const val ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA = 1
internal const val ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA_KEY = "schema"
internal const val ANDROID_DURABLE_CANDIDATE_INPUT_WAKE_ID_KEY = "wake_work_id"
internal const val ANDROID_DURABLE_CANDIDATE_INPUT_PREDECESSOR_ID_KEY = "predecessor_work_id"
internal const val ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY = "run_id"

internal data class AndroidDurableCandidateWakeInput(
  val wakeWorkId: String,
  val predecessorWorkId: String,
  val runId: String,
) {
  companion object {
    private val expectedKeys = setOf(
      ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA_KEY,
      ANDROID_DURABLE_CANDIDATE_INPUT_WAKE_ID_KEY,
      ANDROID_DURABLE_CANDIDATE_INPUT_PREDECESSOR_ID_KEY,
      ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY,
    )

    fun parse(data: Data, actualWakeWorkId: String): AndroidDurableCandidateWakeInput? {
      val values = data.keyValueMap
      if (values.keys != expectedKeys) return null
      if (
        values[ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA_KEY] !=
        ANDROID_DURABLE_CANDIDATE_INPUT_SCHEMA
      ) {
        return null
      }
      val wakeWorkId = values[ANDROID_DURABLE_CANDIDATE_INPUT_WAKE_ID_KEY] as? String
        ?: return null
      val predecessorWorkId =
        values[ANDROID_DURABLE_CANDIDATE_INPUT_PREDECESSOR_ID_KEY] as? String ?: return null
      val runId = values[ANDROID_DURABLE_CANDIDATE_INPUT_RUN_ID_KEY] as? String ?: return null
      if (
        wakeWorkId != actualWakeWorkId ||
        parseCanonicalUuid(wakeWorkId) == null ||
        parseCanonicalUuid(predecessorWorkId) == null ||
        !validRunId(runId)
      ) {
        return null
      }
      return AndroidDurableCandidateWakeInput(wakeWorkId, predecessorWorkId, runId)
    }

    private fun parseCanonicalUuid(value: String): UUID? = try {
      UUID.fromString(value).takeIf { it.toString() == value }
    } catch (_: IllegalArgumentException) {
      null
    }

    private fun validRunId(value: String): Boolean =
      value.isNotEmpty() &&
        value.length <= 200 &&
        value == value.trim() &&
        value.none { it.code < 0x20 || it.code == 0x7f }
  }
}

internal data class AndroidDurableCandidateHeadlessPayload(
  val wakeWorkId: String,
  val predecessorWorkId: String,
  val runId: String,
)

internal fun interface AndroidDurableCandidateHeadlessDispatcher {
  suspend fun dispatchCandidateWake(
    payload: AndroidDurableCandidateHeadlessPayload,
  ): AndroidDurableHeadlessDispatchResult
}

internal enum class AndroidDurableCandidateWakeOutcome {
  COMPLETED,
  RETRY,
}

/**
 * Process-local acknowledgement fence between the JS task and its WorkManager owner.
 *
 * Losing the process loses the acknowledgement and therefore retries the durable WorkRequest;
 * an acknowledgement can never be reused by another attempt or run.
 */
internal class AndroidDurableCandidateWakeTracker {
  private data class Entry(
    val runId: String,
    val predecessorWorkId: String,
    @Volatile var outcome: AndroidDurableCandidateWakeOutcome? = null,
  )

  private val entries = ConcurrentHashMap<String, Entry>()

  fun start(wakeWorkId: String, predecessorWorkId: String, runId: String): Boolean =
    entries.putIfAbsent(wakeWorkId, Entry(runId, predecessorWorkId)) == null

  fun acknowledge(
    wakeWorkId: String,
    predecessorWorkId: String,
    runId: String,
    outcome: AndroidDurableCandidateWakeOutcome,
  ): Boolean {
    val entry = entries[wakeWorkId] ?: return false
    if (entry.runId != runId || entry.predecessorWorkId != predecessorWorkId) return false
    synchronized(entry) {
      if (entry.outcome != null) return false
      entry.outcome = outcome
      return true
    }
  }

  fun consume(wakeWorkId: String, runId: String): AndroidDurableCandidateWakeOutcome? {
    val entry = entries[wakeWorkId] ?: return null
    if (entry.runId != runId || !entries.remove(wakeWorkId, entry)) return null
    return entry.outcome
  }

  fun discard(wakeWorkId: String, runId: String) {
    val entry = entries[wakeWorkId] ?: return
    if (entry.runId == runId) entries.remove(wakeWorkId, entry)
  }
}
