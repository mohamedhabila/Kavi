import type { Message } from '../../types/message';

const RECENT_USER_QUERY_WINDOW_TURNS = 4;
const RECENT_USER_QUERY_WINDOW_CHARS = 2_000;

export function buildRecentUserRetrievalQuery(
  messages: ReadonlyArray<Message>,
  maxTurns = RECENT_USER_QUERY_WINDOW_TURNS,
  maxChars = RECENT_USER_QUERY_WINDOW_CHARS,
): string {
  const turns: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const candidate = (message.enrichedContent ?? message.content ?? '').trim();
    if (candidate.length > 0) turns.push(candidate);
    if (turns.length >= maxTurns) break;
  }
  const joined = turns.reverse().join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(joined.length - maxChars).trimStart();
}
