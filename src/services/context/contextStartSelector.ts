import type { Message } from '../../types/message';
import {
  resolvePersonaContextPolicy,
  type ContextAccessMode,
  type PersonaContextPolicy,
} from '../agents/personaContextPolicy';

export interface ContextStartSelection {
  startIndex: number;
  reason: 'full_history' | 'single_user_turn' | 'topic_shift_boundary' | 'carryover_limit';
  /**
   * Legacy field, kept for API compatibility with existing callers. No longer
   * derived from content (see module doc): 1 when no structural boundary was
   * applied, 0 when the start index was cut back by an idle-gap boundary or
   * the carryover cap.
   */
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

// ---------------------------------------------------------------------------
// Kavi — Context start selection
// ---------------------------------------------------------------------------
// Decides how far back into the conversation history a turn's context should
// reach. This used to run a Jaccard word-overlap comparison between the
// latest user turn and prior turns to guess at a "topic shift" — a natural-
// language heuristic that could drop an entire history on a pronoun-only
// follow-up ("what about that one?") or a paraphrase, and that behaved
// inconsistently across scripts.
//
// The boundary is now purely structural:
//   - a hard idle gap (wall-clock time since the previous user turn) or pilot
//     mode forces a fresh start, keeping only the persona's minimum recent
//     turns ('topic_shift_boundary');
//   - otherwise, the persona's max-carryover-turns cap is the only other
//     reason history gets cut ('carryover_limit');
//   - full history is kept otherwise.
// Token-budget windowing (`budgetManager.ts`) and tool-call-group alignment
// (boundaries always land on a user-turn index, which can never split an
// atomic assistant-tool_call + tool-result group) still apply downstream of
// this selection. No model-emitted "new topic" field exists in the
// compaction summary today (`compactionSummary.ts` / `compactionSummarizer.ts`
// build Task Overview / Current State / Open Threads sections only), so one
// isn't invented here — see the task report for that limitation.
// ---------------------------------------------------------------------------

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

  // Position at or after which at least `minRecentUserTurns` turns survive.
  const minRecentFloorPos = Math.max(0, userIndices.length - policy.minRecentUserTurns);

  let selectedUserPos: number;
  let reason: ContextStartSelection['reason'];

  if (enforceTopicBoundary) {
    // A long idle gap (or pilot mode, which always treats the turn as a
    // fresh session) can't be trusted to share context with what came
    // before, so keep only the guaranteed-minimum recent turns.
    selectedUserPos = minRecentFloorPos;
    reason = selectedUserPos > 0 ? 'topic_shift_boundary' : 'full_history';
  } else {
    // No idle-gap signal: the only other structural cut is the persona's
    // max-carryover-turns cap.
    const carryoverFloorPos = Math.max(0, userIndices.length - 1 - policy.maxCarryoverUserTurns);
    selectedUserPos = Math.min(carryoverFloorPos, minRecentFloorPos);
    reason = selectedUserPos > 0 ? 'carryover_limit' : 'full_history';
  }

  const startIndex = userIndices[selectedUserPos] ?? 0;
  const droppedMessageCount = Math.max(0, startIndex);

  return {
    startIndex,
    reason,
    similarityScore: reason === 'full_history' ? 1 : 0,
    idleGapMs,
    droppedMessageCount,
  };
}
