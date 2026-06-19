package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.Conversation
import kotlinx.coroutines.Job
import java.util.concurrent.ConcurrentHashMap

internal class ActiveRequest(
  private val job: Job,
) {
  @Volatile
  private var conversation: Conversation? = null

  fun attachConversation(conversation: Conversation) {
    this.conversation = conversation
  }

  fun detachConversation(conversation: Conversation) {
    if (this.conversation === conversation) {
      this.conversation = null
    }
  }

  fun cancel() {
    conversation?.cancelLiteRtProcess()
    job.cancel()
  }
}

internal class ActiveRequestRegistry {
  private val activeRequests = ConcurrentHashMap<String, ActiveRequest>()

  fun register(requestId: String, job: Job): ActiveRequest? {
    val request = ActiveRequest(job)
    return if (activeRequests.putIfAbsent(requestId, request) == null) {
      request
    } else {
      null
    }
  }

  fun complete(requestId: String) {
    activeRequests.remove(requestId)
  }

  fun cancel(requestId: String) {
    activeRequests.remove(requestId)?.cancel()
  }

  fun cancelAll() {
    val requests = activeRequests.values.toList()
    activeRequests.clear()
    requests.forEach { request -> request.cancel() }
  }
}
