import type { EpisodeShareability } from './accessPolicyTypes';

/**
 * Ordinary chat episodes may follow the user into side threads within the same
 * memory conversation. Task-bound episodes remain thread-local so task context
 * cannot leak into sibling work.
 */
export function resolveTurnEpisodeShareability(
  taskId: string | null | undefined,
): EpisodeShareability {
  return taskId ? 'thread_only' : 'session_threads';
}
