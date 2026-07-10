package com.kavi.mobile.durability

import android.content.Context

internal data class AndroidDurableOutboxReconciliation(
  val scheduling: AndroidDurableOutboxReconciliationResult,
  val cancellation: AndroidDurableOutboxReconciliationResult,
)

/** Process singleton shared by application startup, the native module, and Workers. */
internal class AndroidDurableExecutionRuntime private constructor(context: Context) {
  val store = AndroidSqliteDurableExecutionStore(context)
  val scheduler = AndroidWorkManagerDurablePlatformScheduler(context)
  val adapter = AndroidDurableExecutionAdapter(store, scheduler)
  private val workerRunner = AndroidDurableWorkerRunner(
    store = store,
    adapter = adapter,
    dispatcher = AndroidReactHeadlessRecoveryDispatcher(context),
  )

  suspend fun runWorker(
    platformWorkId: String,
    inputData: androidx.work.Data,
  ): AndroidDurableWorkerResult = workerRunner.run(platformWorkId, inputData)

  fun reconcileOutboxes(limit: Int = DEFAULT_RECONCILIATION_LIMIT) =
    AndroidDurableOutboxReconciliation(
      scheduling = adapter.reconcileScheduling(limit),
      cancellation = adapter.reconcileCancellationRequests(limit),
    )

  companion object {
    private const val DEFAULT_RECONCILIATION_LIMIT = 100

    @Volatile
    private var instance: AndroidDurableExecutionRuntime? = null

    fun get(context: Context): AndroidDurableExecutionRuntime =
      instance ?: synchronized(this) {
        instance ?: AndroidDurableExecutionRuntime(context.applicationContext).also {
          instance = it
        }
      }
  }
}
