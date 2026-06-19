import type { Message } from '../../types/message';
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

type WordSegment = {
  segment: string;
  isWordLike?: boolean;
};

type WordSegmenter = {
  segment(input: string): Iterable<WordSegment>;
};

type WordSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'word' },
) => WordSegmenter;

const WORD_LIKE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
const WORD_LIKE_CODE_POINT_PATTERN = /[\p{L}\p{N}]/u;
const CONTINUOUS_WORD_SCRIPT_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

let cachedWordSegmenter: WordSegmenter | null | undefined;

function getMessageText(message: Message): string {
  const text = message.enrichedContent?.trim() || message.content?.trim() || '';
  return text;
}

function getWordSegmenter(): WordSegmenter | null {
  if (cachedWordSegmenter !== undefined) return cachedWordSegmenter;
  const segmenterCtor = (
    Intl as typeof Intl & {
      Segmenter?: WordSegmenterConstructor;
    }
  ).Segmenter;
  cachedWordSegmenter =
    typeof segmenterCtor === 'function'
      ? new segmenterCtor(undefined, { granularity: 'word' })
      : null;
  return cachedWordSegmenter;
}

function normalizeLexicalText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function hasWordLikeCodePoint(value: string): boolean {
  return WORD_LIKE_CODE_POINT_PATTERN.test(value);
}

function addSegmentUnits(units: Set<string>, rawSegment: string): void {
  const segment = normalizeLexicalText(rawSegment).trim();
  if (!segment || !hasWordLikeCodePoint(segment)) return;
  units.add(segment);

  if (!CONTINUOUS_WORD_SCRIPT_PATTERN.test(segment)) return;
  const codePoints = Array.from(segment);
  for (const width of [2, 3]) {
    if (codePoints.length < width) continue;
    for (let index = 0; index <= codePoints.length - width; index += 1) {
      units.add(`${width}:${codePoints.slice(index, index + width).join('')}`);
    }
  }
}

function addUnicodeSequenceUnits(units: Set<string>, value: string): void {
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    addSegmentUnits(units, match[0]);
  }
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeLexicalText(text);
  const units = new Set<string>();
  const segmenter = getWordSegmenter();
  if (segmenter) {
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike === false) continue;
      addSegmentUnits(units, segment.segment);
    }
  }
  addUnicodeSequenceUnits(units, normalized);
  return units;
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

export function buildFullHistoryContextStartSelection(messages: Message[]): ContextStartSelection {
  const userCount = getUserMessageIndices(messages).length;
  return {
    startIndex: 0,
    reason: userCount === 1 ? 'single_user_turn' : 'full_history',
    similarityScore: 1,
    idleGapMs: 0,
    droppedMessageCount: 0,
  };
}

function getPreviousMessageTimestamp(
  messages: Message[],
  latestUserIndex: number,
): number | undefined {
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
    return buildFullHistoryContextStartSelection(messages);
  }

  const basePolicy = resolvePersonaContextPolicy(options.personaId, options.mode);
  const policy: PersonaContextPolicy = {
    ...basePolicy,
    ...(options.policyOverride ?? {}),
  };

  const userIndices = getUserMessageIndices(messages);
  if (userIndices.length <= 1) {
    return buildFullHistoryContextStartSelection(messages);
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
  const enforceTopicBoundary = idleGapMs >= policy.hardIdleCutoffMs || options.mode === 'pilot';

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
