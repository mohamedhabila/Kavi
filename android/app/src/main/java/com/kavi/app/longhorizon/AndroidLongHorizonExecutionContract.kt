package com.kavi.mobile.longhorizon

internal const val ANDROID_LONG_HORIZON_BRIDGE_SCHEMA = 1
internal const val ANDROID_LONG_HORIZON_CANCEL_EVENT = "KaviLongHorizonCancelRequested"
internal const val ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY =
  "KaviLongHorizonExecutionKeepAlive"

internal enum class AndroidLongHorizonCancellationReason(val bridgeName: String) {
  USER_REQUESTED("user_requested"),
  BACKGROUND_CONTINUITY_UNAVAILABLE("background_continuity_unavailable"),
  SERVICE_STOPPED_UNEXPECTEDLY("service_stopped_unexpectedly"),
}

internal enum class AndroidLongHorizonTaskKind(val bridgeName: String) {
  CHAT("chat"),
  SUB_AGENT("sub_agent"),
  ;

  companion object {
    fun fromBridgeName(value: String): AndroidLongHorizonTaskKind? =
      entries.firstOrNull { it.bridgeName == value }
  }
}

internal data class AndroidLongHorizonLease(
  val leaseId: String,
  val taskKind: AndroidLongHorizonTaskKind,
)

internal sealed interface AndroidLongHorizonLeaseMutation {
  val activeLeaseCount: Int

  data class Accepted(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonLeaseMutation

  data class NoOp(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonLeaseMutation

  data class Released(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonLeaseMutation

  data class Missing(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonLeaseMutation
}

internal class AndroidLongHorizonLeaseRegistry {
  private val leases = linkedMapOf<String, AndroidLongHorizonLease>()

  fun acquire(lease: AndroidLongHorizonLease): AndroidLongHorizonLeaseMutation {
    val existing = leases[lease.leaseId]
    if (existing != null) {
      return AndroidLongHorizonLeaseMutation.NoOp(leases.size)
    }
    leases[lease.leaseId] = lease
    return AndroidLongHorizonLeaseMutation.Accepted(leases.size)
  }

  fun release(leaseId: String): AndroidLongHorizonLeaseMutation {
    if (leases.remove(leaseId) == null) {
      return AndroidLongHorizonLeaseMutation.Missing(leases.size)
    }
    return AndroidLongHorizonLeaseMutation.Released(leases.size)
  }

  fun clear(): Int {
    val cleared = leases.size
    leases.clear()
    return cleared
  }

  fun size(): Int = leases.size
}

internal enum class AndroidLongHorizonUnavailableReason(val bridgeName: String) {
  FOREGROUND_SERVICE_START_NOT_ALLOWED("foreground_service_start_not_allowed"),
  FOREGROUND_SERVICE_PERMISSION_MISSING("foreground_service_permission_missing"),
  FOREGROUND_SERVICE_START_FAILED("foreground_service_start_failed"),
}

internal sealed interface AndroidLongHorizonBridgeResult {
  val activeLeaseCount: Int

  data class Accepted(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonBridgeResult

  data class NoOp(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonBridgeResult

  data class Released(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonBridgeResult

  data class Missing(
    override val activeLeaseCount: Int,
  ) : AndroidLongHorizonBridgeResult

  data class Unavailable(
    override val activeLeaseCount: Int,
    val reason: AndroidLongHorizonUnavailableReason,
  ) : AndroidLongHorizonBridgeResult
}
