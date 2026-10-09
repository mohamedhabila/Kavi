import type { ForegroundRequestRegistry } from './requestRegistry';
import type { QueuedSteeringMessage, SteeringQueue } from './steeringQueue';

type RequestRegistry = Pick<ForegroundRequestRegistry, 'getRequestId' | 'subscribe'>;

/** Resolves with the conversation's foreground request once it is no longer `runId`. */
function waitForRequestChange(
  registry: RequestRegistry,
  conversationId: string,
  runId: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const check = (): void => {
      if (settled) return;
      const current = registry.getRequestId(conversationId);
      if (current === runId) return;
      settled = true;
      unsubscribe();
      resolve(current);
    };
    unsubscribe = registry.subscribe(check);
    check();
  });
}

/**
 * Follow a steer until a run takes it or no run is left to take it. When another
 * foreground run of the conversation follows the one it targets (an automatic
 * continuation), the steer moves to that run. Once no run is active, whatever the runs
 * did not take comes back — removed from the queue, oldest first — for the caller to
 * send as the next turn, so a message is never left waiting for a run that has ended.
 */
export async function settleSteering(params: {
  conversationId: string;
  runId: string;
  queue: Pick<SteeringQueue, 'take' | 'retarget'>;
  registry: RequestRegistry;
}): Promise<QueuedSteeringMessage[]> {
  let runId = params.runId;
  for (;;) {
    const next = await waitForRequestChange(params.registry, params.conversationId, runId);
    if (next === null) return params.queue.take(params.conversationId, runId);
    params.queue.retarget(params.conversationId, runId, next);
    runId = next;
  }
}
