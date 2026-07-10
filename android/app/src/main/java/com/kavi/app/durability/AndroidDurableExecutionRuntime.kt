package com.kavi.mobile.durability

import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

internal data class AndroidDurableOutboxReconciliation(
  val scheduling: AndroidDurableOutboxReconciliationResult,
  val cancellation: AndroidDurableOutboxReconciliationResult,
)

/** Process singleton shared by application startup, the native module, and Workers. */
internal class AndroidDurableExecutionRuntime private constructor(context: Context) {
  val store = AndroidSqliteDurableExecutionStore(context)
  val scheduler = AndroidWorkManagerDurablePlatformScheduler(context)
  val adapter = AndroidDurableExecutionAdapter(store, scheduler)
  val candidateWakeTracker = AndroidDurableCandidateWakeTracker()
  private val headlessDispatcher = AndroidReactHeadlessRecoveryDispatcher(context)
  private val workerRunner = AndroidDurableWorkerRunner(
    store = store,
    adapter = adapter,
    dispatcher = headlessDispatcher,
  )
  private val candidateWakeRunner = AndroidDurableCandidateWakeRunner(
    dispatcher = headlessDispatcher,
    tracker = candidateWakeTracker,
  )

  suspend fun runWorker(
    platformWorkId: String,
    inputData: androidx.work.Data,
  ): AndroidDurableWorkerResult = workerRunner.run(platformWorkId, inputData)

  suspend fun runCandidateWake(
    actualWakeWorkId: String,
    inputData: androidx.work.Data,
    runAttemptCount: Int,
  ): AndroidDurableWorkerResult = candidateWakeRunner.run(
    actualWakeWorkId = actualWakeWorkId,
    inputData = inputData,
    runAttemptCount = runAttemptCount,
  )

  fun reconcileOutboxes(limit: Int = DEFAULT_RECONCILIATION_LIMIT) =
    AndroidDurableOutboxReconciliation(
      scheduling = adapter.reconcileScheduling(limit),
      cancellation = adapter.reconcileCancellationRequests(limit),
    )

  companion object {
    private const val DEFAULT_RECONCILIATION_LIMIT = 100
    private const val MAX_STARTUP_RECONCILIATION_BATCHES = 10
    private const val LOG_TAG = "KaviDurableExecution"

    @Volatile
    private var instance: AndroidDurableExecutionRuntime? = null
    private val startupReconciliationStarted = AtomicBoolean(false)

    fun get(context: Context): AndroidDurableExecutionRuntime =
      instance ?: synchronized(this) {
        instance ?: AndroidDurableExecutionRuntime(context.applicationContext).also {
          instance = it
        }
      }

    /** Repairs persistence-first enqueue/cancel crash windows without blocking Application.onCreate. */
    fun reconcileProcessStart(context: Context) {
      if (!startupReconciliationStarted.compareAndSet(false, true)) return
      Thread(
        {
          try {
            val runtime = get(context)
            val scheduling = drainStartupOutbox(runtime.adapter::reconcileScheduling)
            val cancellation = drainStartupOutbox(
              runtime.adapter::reconcileCancellationRequests,
            )
            if (scheduling.needsAttention || cancellation.needsAttention) {
              Log.w(
                LOG_TAG,
                "Startup durability reconciliation completed with deferred or rejected rows.",
              )
            }
          } catch (error: Exception) {
            Log.e(LOG_TAG, "Startup durability reconciliation failed.", error)
          }
        },
        "kavi-durable-execution-startup",
      ).start()
    }

    private fun drainStartupOutbox(
      reconcile: (Int) -> AndroidDurableOutboxReconciliationResult,
    ): StartupReconciliationSummary {
      var needsAttention = false
      repeat(MAX_STARTUP_RECONCILIATION_BATCHES) {
        when (val batch = reconcile(DEFAULT_RECONCILIATION_LIMIT)) {
          AndroidDurableOutboxReconciliationResult.StoreUnavailable ->
            return StartupReconciliationSummary(needsAttention = true)
          is AndroidDurableOutboxReconciliationResult.Completed -> {
            needsAttention = needsAttention || batch.outcomes.any { outcome ->
              outcome.result is AndroidDurableAdapterResult.Deferred ||
                outcome.result is AndroidDurableAdapterResult.Rejected ||
                outcome.result is AndroidDurableAdapterResult.Unsupported
            }
            if (batch.outcomes.size < DEFAULT_RECONCILIATION_LIMIT) {
              return StartupReconciliationSummary(needsAttention)
            }
            val madeProgress = batch.outcomes.any { outcome ->
              val record = when (val result = outcome.result) {
                is AndroidDurableAdapterResult.Accepted -> result.record
                is AndroidDurableAdapterResult.NoOp -> result.record
                else -> null
              }
              record != null && record.state != AndroidDurableExecutionState.SCHEDULING &&
                record.state != AndroidDurableExecutionState.CANCEL_REQUESTED
            }
            if (!madeProgress) return StartupReconciliationSummary(needsAttention = true)
          }
        }
      }
      return StartupReconciliationSummary(needsAttention = true)
    }

    private data class StartupReconciliationSummary(
      val needsAttention: Boolean,
    )
  }
}
