package com.kavi.mobile.durability

import androidx.work.Data
import java.util.UUID

internal const val ANDROID_DURABLE_WORK_INPUT_SCHEMA = 1
internal const val ANDROID_DURABLE_WORK_INPUT_SCHEMA_KEY = "schema"
internal const val ANDROID_DURABLE_WORK_INPUT_ID_KEY = "work_id"
internal const val ANDROID_DURABLE_WORK_INPUT_RUN_ID_KEY = "run_id"
internal const val ANDROID_DURABLE_WORK_INPUT_CONTROL_EPOCH_KEY = "control_epoch"
internal const val ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_UPDATED_AT_KEY = "snapshot_updated_at"
internal const val ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY = "snapshot_digest"
internal const val ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY = "command_kind"
internal const val ANDROID_DURABLE_WORK_INPUT_COMMAND_DIGEST_KEY = "command_digest"

internal data class AndroidDurableWorkInput(
  val platformWorkId: String,
  val identity: AndroidRecoveryCommandIdentity,
) {
  fun matches(record: AndroidDurableExecutionRecord): Boolean =
    record.platformWorkId == platformWorkId && record.request.identity == identity

  fun pointer() = AndroidDurableExecutionPointer(
    runId = identity.runId,
    controlEpoch = identity.controlEpoch,
    snapshotUpdatedAtMillis = identity.snapshotUpdatedAtMillis,
    snapshotDigest = identity.snapshotDigest,
    commandDigest = identity.commandDigest,
  )

  companion object {
    private val EXPECTED_KEYS = setOf(
      ANDROID_DURABLE_WORK_INPUT_SCHEMA_KEY,
      ANDROID_DURABLE_WORK_INPUT_ID_KEY,
      ANDROID_DURABLE_WORK_INPUT_RUN_ID_KEY,
      ANDROID_DURABLE_WORK_INPUT_CONTROL_EPOCH_KEY,
      ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_UPDATED_AT_KEY,
      ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY,
      ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY,
      ANDROID_DURABLE_WORK_INPUT_COMMAND_DIGEST_KEY,
    )
    private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

    fun parse(data: Data): AndroidDurableWorkInput? {
      val values = data.keyValueMap
      if (values.keys != EXPECTED_KEYS) return null
      if (values[ANDROID_DURABLE_WORK_INPUT_SCHEMA_KEY] != ANDROID_DURABLE_WORK_INPUT_SCHEMA) {
        return null
      }
      val platformWorkId = values[ANDROID_DURABLE_WORK_INPUT_ID_KEY] as? String ?: return null
      val runId = values[ANDROID_DURABLE_WORK_INPUT_RUN_ID_KEY] as? String ?: return null
      val controlEpoch = values[ANDROID_DURABLE_WORK_INPUT_CONTROL_EPOCH_KEY] as? Long ?: return null
      val snapshotUpdatedAt =
        values[ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_UPDATED_AT_KEY] as? Long ?: return null
      val snapshotDigest =
        values[ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY] as? String ?: return null
      val commandKindName =
        values[ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY] as? String ?: return null
      val commandDigest =
        values[ANDROID_DURABLE_WORK_INPUT_COMMAND_DIGEST_KEY] as? String ?: return null
      val commandKind = AndroidRecoveryCommandKind.entries.singleOrNull {
        it.name == commandKindName
      } ?: return null
      if (
        parseUuid(platformWorkId) == null ||
        runId.isEmpty() ||
        runId != runId.trim() ||
        runId.length > 200 ||
        controlEpoch < 0 ||
        snapshotUpdatedAt < 0 ||
        !SHA256_DIGEST.matches(snapshotDigest) ||
        !SHA256_DIGEST.matches(commandDigest)
      ) {
        return null
      }
      return AndroidDurableWorkInput(
        platformWorkId = platformWorkId,
        identity = AndroidRecoveryCommandIdentity(
          runId = runId,
          controlEpoch = controlEpoch,
          snapshotUpdatedAtMillis = snapshotUpdatedAt,
          snapshotDigest = snapshotDigest,
          commandKind = commandKind,
          commandDigest = commandDigest,
        ),
      )
    }

    private fun parseUuid(value: String): UUID? = try {
      UUID.fromString(value).takeIf { it.toString() == value }
    } catch (_: IllegalArgumentException) {
      null
    }
  }
}

internal data class AndroidDurableHeadlessPayload(
  val work: AndroidDurableWorkInput,
  val attempt: Int,
)

internal enum class AndroidDurableHeadlessDispatchResult {
  FINISHED,
  UNAVAILABLE,
  TIMED_OUT,
}

internal fun interface AndroidDurableHeadlessDispatcher {
  suspend fun dispatch(payload: AndroidDurableHeadlessPayload): AndroidDurableHeadlessDispatchResult
}
