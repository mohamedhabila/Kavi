package com.kavi.mobile.notifications

/** One notification another app showed, as Kavi may read it back to the person. */
internal data class KaviNotificationRecord(
  val key: String,
  val packageName: String,
  val appName: String,
  val title: String,
  val text: String,
  val postedAtMs: Long,
)

/**
 * The notifications that arrived while the listener was connected, newest last. Bounded: the
 * oldest fall off past [capacity]. A notification that is updated in place (same key) replaces
 * its earlier version and moves to the newest position.
 */
internal class KaviNotificationLog(private val capacity: Int = DEFAULT_CAPACITY) {
  private val records = ArrayDeque<KaviNotificationRecord>()

  @Synchronized
  fun add(record: KaviNotificationRecord) {
    records.removeAll { it.key == record.key }
    records.addLast(record)
    while (records.size > capacity) records.removeFirst()
  }

  @Synchronized
  fun find(key: String): KaviNotificationRecord? = records.lastOrNull { it.key == key }

  /** Records posted at or after [sinceMs], newest first, at most [limit]. */
  @Synchronized
  fun recent(sinceMs: Long, limit: Int): List<KaviNotificationRecord> =
    records.asReversed().asSequence().filter { it.postedAtMs >= sinceMs }.take(limit).toList()

  internal companion object {
    const val DEFAULT_CAPACITY = 200
    const val MAX_TEXT_LENGTH = 1_000

    /** The one log the listener writes and the module reads, for the app process. */
    val shared = KaviNotificationLog()
  }
}
