import type { Message } from '../../../types/message';
import { deduplicateToolResults, ensureToolResultPairing } from '../../toolResultPairingGuard';

export function buildModelReadyMessages(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}
