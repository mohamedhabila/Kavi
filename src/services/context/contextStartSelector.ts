import type { Message } from '../../types';
import {
  resolvePersonaContextPolicy,
  type ContextAccessMode,
  type PersonaContextPolicy,
} from '../agents/personaContextPolicy';

export interface ContextStartSelection {
  startIndex: number;
  reason: 'full_history' | 'single_user_turn' | 'topic_shift_boundary' | 'carryover_limit';
  similarityScore: number;
  idleGapMs: number;
  droppedMessageCount: number;
}

export interface ContextStartSelectionOptions {
  personaId?: string;
  mode: ContextAccessMode;
  now?: number;
  policyOverride?: Partial<PersonaContextPolicy>;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'with',
  'you',
  'your',
]);

function getMessageText(message: Message): string {
  const text = message.enrichedContent?.trim() || message.content?.trim() || '';
  return text;
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function getUserMessageIndices(messages: Message[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role === 'user') {
      indices.push(i);
    }
  }
  return indices;
}

function getPreviousMessageTimestamp(messages: Message[], latestUserIndex: number): number | undefined {
  for (let i = latestUserIndex - 1; i >= 0; i -= 1) {
    const timestamp = messages[i]?.timestamp;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return undefined;
}

function getPreviousUserMessageTimestamp(
  messages: Message[],
  userIndices: number[],
): number | undefined {
  for (let i = userIndices.length - 2; i >= 0; i -= 1) {
    const messageIndex = userIndices[i];
    const timestamp = messages[messageIndex]?.timestamp;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return undefined;
}

export function selectContextStartIndex(
  messages: Message[],
  options: ContextStartSelectionOptions,
): ContextStartSelection {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      startIndex: 0,
      reason: 'full_history',
      similarityScore: 1,
      idleGapMs: 0,
      droppedMessageCount: 0,
    };
  }

  const basePolicy = resolvePersonaContextPolicy(options.personaId, options.mode);
  const policy: PersonaContextPolicy = {
    ...basePolicy,
    ...(options.policyOverride ?? {}),
  };

  const userIndices = getUserMessageIndices(messages);
  if (userIndices.length <= 1) {
    return {
      startIndex: 0,
      reason: userIndices.length === 1 ? 'single_user_turn' : 'full_history',
      similarityScore: 1,
      idleGapMs: 0,
      droppedMessageCount: 0,
    };
  }

  const latestUserIndex = userIndices[userIndices.length - 1];
  const latestUserText = getMessageText(messages[latestUserIndex]);

  const previousUserTimestamp = getPreviousUserMessageTimestamp(messages, userIndices);
  const previousTimestamp =
    previousUserTimestamp ?? getPreviousMessageTimestamp(messages, latestUserIndex);
  const latestTimestamp = messages[latestUserIndex].timestamp;
  const now = typeof options.now === 'number' ? options.now : latestTimestamp;
  const idleGapMs =
    typeof previousTimestamp === 'number' && Number.isFinite(previousTimestamp)
      ? Math.max(0, now - previousTimestamp)
      : 0;
  const enforceTopicBoundary =
    idleGapMs >= policy.hardIdleCutoffMs || options.mode === 'pilot';

  let selectedUserPos = userIndices.length - 1;
  let includedCarryover = 0;
  let lastSimilarity = 1;
  let reason: ContextStartSelection['reason'] = 'full_history';

  for (let pos = userIndices.length - 2; pos >= 0; pos -= 1) {
    if (includedCarryover >= policy.maxCarryoverUserTurns) {
      reason = 'carryover_limit';
      break;
    }

    const candidateText = getMessageText(messages[userIndices[pos]]);
    const similarity = jaccardSimilarity(latestUserText, candidateText);
    lastSimilarity = similarity;

    if (similarity >= policy.semanticSimilarityThreshold) {
      selectedUserPos = pos;
      includedCarryover += 1;
      continue;
    }

    if (!enforceTopicBoundary && policy.allowCrossTopicCarryover) {
      selectedUserPos = pos;
      includedCarryover += 1;
      continue;
    }

    if (!enforceTopicBoundary && includedCarryover < Math.max(0, policy.minRecentUserTurns - 1)) {
      selectedUserPos = pos;
      includedCarryover += 1;
      continue;
    }

    reason = 'topic_shift_boundary';
    break;
  }

  const requiredStartPos = Math.max(0, userIndices.length - policy.minRecentUserTurns);
  if (selectedUserPos > requiredStartPos) {
    selectedUserPos = requiredStartPos;
  }

  const startIndex = userIndices[selectedUserPos] ?? 0;
  const droppedMessageCount = Math.max(0, startIndex);

  if (startIndex === 0 && reason !== 'carryover_limit') {
    reason = 'full_history';
  }

  return {
    startIndex,
    reason,
    similarityScore: lastSimilarity,
    idleGapMs,
    droppedMessageCount,
  };
}
