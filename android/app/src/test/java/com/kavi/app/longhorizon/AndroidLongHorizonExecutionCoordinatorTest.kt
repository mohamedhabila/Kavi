package com.kavi.mobile.longhorizon

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLongHorizonExecutionCoordinatorTest {
  @Test
  fun `leases keep one service alive until the last task releases`() {
    val service = FakeServiceController()
    var idleCount = 0
    val coordinator = coordinator(
      service,
      idleEmitter = AndroidLongHorizonIdleEmitter { idleCount += 1 },
    )

    assertEquals(
      AndroidLongHorizonBridgeResult.Accepted(1),
      coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT)),
    )
    assertEquals(
      AndroidLongHorizonBridgeResult.Accepted(2),
      coordinator.acquire(lease("worker-1", AndroidLongHorizonTaskKind.SUB_AGENT)),
    )
    assertEquals(
      AndroidLongHorizonBridgeResult.Released(1),
      coordinator.release("chat-1"),
    )
    assertEquals(
      AndroidLongHorizonBridgeResult.Released(0),
      coordinator.release("worker-1"),
    )

    assertEquals(listOf(1), service.starts)
    assertEquals(listOf(2, 1), service.updates)
    assertEquals(1, service.stopCount)
    assertEquals(1, idleCount)
  }

  @Test
  fun `duplicate acquire and release are idempotent`() {
    val service = FakeServiceController()
    val coordinator = coordinator(service)

    coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT))
    assertEquals(
      AndroidLongHorizonBridgeResult.NoOp(1),
      coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT)),
    )
    coordinator.release("chat-1")
    assertEquals(AndroidLongHorizonBridgeResult.Missing(0), coordinator.release("chat-1"))

    assertEquals(listOf(1), service.starts)
    assertTrue(service.updates.isEmpty())
    assertEquals(1, service.stopCount)
  }

  @Test
  fun `failed service start rolls back the lease`() {
    val service = FakeServiceController(startFailure = SecurityException("permission"))
    var idleCount = 0
    val coordinator = coordinator(
      service,
      idleEmitter = AndroidLongHorizonIdleEmitter { idleCount += 1 },
    )

    assertEquals(
      AndroidLongHorizonBridgeResult.Unavailable(
        activeLeaseCount = 0,
        reason = AndroidLongHorizonUnavailableReason.FOREGROUND_SERVICE_PERMISSION_MISSING,
      ),
      coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT)),
    )
    assertEquals(0, coordinator.activeLeaseCount())
    assertEquals(AndroidLongHorizonBridgeResult.Missing(0), coordinator.release("chat-1"))
    assertEquals(1, idleCount)
  }

  @Test
  fun `visible work starts once and keeps its task count current across foreground transitions`() {
    val service = FakeServiceController()
    val coordinator = coordinator(service)
    coordinator.onHostForegrounded()

    assertEquals(
      AndroidLongHorizonBridgeResult.Accepted(1),
      coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT)),
    )
    assertTrue(service.starts.isEmpty())

    coordinator.onHostBackgrounded()
    assertEquals(listOf(1), service.starts)
    coordinator.onHostForegrounded()
    assertEquals(0, service.stopCount)
    assertEquals(1, coordinator.activeLeaseCount())
    assertTrue(coordinator.shouldRunService())
    assertEquals(
      AndroidLongHorizonBridgeResult.Accepted(2),
      coordinator.acquire(lease("worker-1", AndroidLongHorizonTaskKind.SUB_AGENT)),
    )
    assertEquals(listOf(2), service.updates)

    coordinator.onHostBackgrounded()
    assertEquals(listOf(1), service.starts)
    coordinator.release("chat-1")
    assertEquals(listOf(2, 1), service.updates)
    coordinator.release("worker-1")
    assertEquals(1, service.stopCount)
  }

  @Test
  fun `background start failure cancels accepted foreground work`() {
    val service = FakeServiceController(startFailure = SecurityException("permission"))
    val cancellationReasons = mutableListOf<AndroidLongHorizonCancellationReason>()
    val coordinator = coordinator(
      service,
      cancellationEmitter = AndroidLongHorizonCancellationEmitter { reason ->
        cancellationReasons += reason
      },
    )
    coordinator.onHostForegrounded()

    assertEquals(
      AndroidLongHorizonBridgeResult.Accepted(1),
      coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT)),
    )
    coordinator.onHostBackgrounded()

    assertEquals(0, coordinator.activeLeaseCount())
    assertEquals(
      listOf(AndroidLongHorizonCancellationReason.BACKGROUND_CONTINUITY_UNAVAILABLE),
      cancellationReasons,
    )
    assertEquals(1, service.stopCount)
  }

  @Test
  fun `user stop and unexpected service loss cancel every active owner`() {
    val service = FakeServiceController()
    val cancellationReasons = mutableListOf<AndroidLongHorizonCancellationReason>()
    var idleCount = 0
    val coordinator = coordinator(
      service,
      cancellationEmitter = AndroidLongHorizonCancellationEmitter { reason ->
        cancellationReasons += reason
      },
      idleEmitter = AndroidLongHorizonIdleEmitter { idleCount += 1 },
    )
    coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT))
    coordinator.acquire(lease("worker-1", AndroidLongHorizonTaskKind.SUB_AGENT))

    coordinator.cancelFromUser()
    assertEquals(
      listOf(AndroidLongHorizonCancellationReason.USER_REQUESTED),
      cancellationReasons,
    )
    assertEquals(0, coordinator.activeLeaseCount())

    coordinator.acquire(lease("chat-2", AndroidLongHorizonTaskKind.CHAT))
    coordinator.handleUnexpectedServiceStop()
    assertEquals(
      listOf(
        AndroidLongHorizonCancellationReason.USER_REQUESTED,
        AndroidLongHorizonCancellationReason.SERVICE_STOPPED_UNEXPECTEDLY,
      ),
      cancellationReasons,
    )
    assertEquals(2, idleCount)
    assertEquals(0, coordinator.activeLeaseCount())
  }

  @Test
  fun `background scheduler failure releases ownership truthfully`() {
    val service = FakeServiceController()
    val cancellationReasons = mutableListOf<AndroidLongHorizonCancellationReason>()
    var idleCount = 0
    val coordinator = coordinator(
      service,
      cancellationEmitter = AndroidLongHorizonCancellationEmitter { reason ->
        cancellationReasons += reason
      },
      idleEmitter = AndroidLongHorizonIdleEmitter { idleCount += 1 },
    )
    coordinator.acquire(lease("chat-1", AndroidLongHorizonTaskKind.CHAT))

    coordinator.handleBackgroundSchedulerUnavailable()

    assertEquals(0, coordinator.activeLeaseCount())
    assertEquals(
      listOf(AndroidLongHorizonCancellationReason.BACKGROUND_CONTINUITY_UNAVAILABLE),
      cancellationReasons,
    )
    assertEquals(1, idleCount)
  }

  private fun coordinator(
    service: FakeServiceController,
    cancellationEmitter: AndroidLongHorizonCancellationEmitter =
      AndroidLongHorizonCancellationEmitter { _ -> },
    idleEmitter: AndroidLongHorizonIdleEmitter = AndroidLongHorizonIdleEmitter {},
  ) = AndroidLongHorizonExecutionCoordinator(
    registry = AndroidLongHorizonLeaseRegistry(),
    serviceController = service,
    cancellationBus = cancellationEmitter,
    idleBus = idleEmitter,
    warningLogger = { _, _ -> },
  )

  private fun lease(id: String, kind: AndroidLongHorizonTaskKind) =
    AndroidLongHorizonLease(id, kind)

  private class FakeServiceController(
    private val startFailure: Exception? = null,
  ) : AndroidLongHorizonServiceController {
    val starts = mutableListOf<Int>()
    val updates = mutableListOf<Int>()
    var stopCount = 0

    override fun start(activeLeaseCount: Int) {
      startFailure?.let { throw it }
      starts += activeLeaseCount
    }

    override fun update(activeLeaseCount: Int) {
      updates += activeLeaseCount
    }

    override fun stop() {
      stopCount += 1
    }
  }
}
