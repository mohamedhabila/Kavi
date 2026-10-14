// ---------------------------------------------------------------------------
// Kavi — LongMemEval results
// ---------------------------------------------------------------------------
// One outcome per question and the summary the benchmark is judged by: accuracy overall
// and averaged over question types (LongMemEval reports both), per type, on unanswerable
// questions, how often an evidence session and how many of the rounds that hold the answer
// reached the memory section, how often the model searched memory, and what the run cost
// in tokens and time.
// ---------------------------------------------------------------------------

import {
  LONGMEMEVAL_QUESTION_TYPES,
  type LongMemEvalInstance,
  type LongMemEvalQuestionType,
} from './longMemEvalDataset';
import {
  historyMessageId,
  sessionIndexOfHistoryMessage,
  type LongMemEvalArm,
} from './longMemEvalScenario';
import type { E2EScenarioResult } from '../e2eAgent/types';
import type { LongMemEvalMemoryAudit } from './longMemEvalMemoryAudit';

export type LongMemEvalOutcome = Readonly<{
  questionId: string;
  questionType: LongMemEvalQuestionType;
  abstention: boolean;
  arm: LongMemEvalArm;
  hypothesis: string;
  correct: boolean;
  judgeReply: string;
  completed: boolean;
  durationMs: number;
  /** The conversation's and background memory extraction's tokens together. */
  totalTokens: number;
  /** Estimated spend in USD, or null when the provider's prices are unknown. */
  costUsd: number | null;
  /** The conversation's input tokens, and how many of them were read from the provider cache. */
  inputTokens: number;
  cacheReadTokens: number;
  memorySearchCalls: number;
  /**
   * Whether a round of an evidence session reached the model, in the memory section or in the
   * thread the request carried; null when not measured.
   */
  evidenceInPrompt: boolean | null;
  /** Share of the rounds that hold the answer that reached the model either way; null when not measured. */
  answerRoundRecall: number | null;
  /** Background memory work's tokens (extraction, the memory section's selection). */
  memoryTokens: number;
  /** Extract arm: whether extraction caught up before the question; null for other arms. */
  extractionSettled: boolean | null;
  /** Extract arm: what the store held when the question was asked; null for other arms. */
  memoryAudit: LongMemEvalMemoryAudit | null;
  /** How many distinct memories the requests' memory sections showed. */
  memoryItemsShown: number;
  errors: ReadonlyArray<string>;
}>;

type Score = Readonly<{ questions: number; correct: number; accuracy: number | null }>;

export type LongMemEvalSummary = Readonly<{
  arm: LongMemEvalArm | 'mixed';
  overall: Score;
  /** Mean of the per-type accuracies, over the types that have questions. */
  taskAveragedAccuracy: number | null;
  byType: Readonly<Record<LongMemEvalQuestionType, Score>>;
  abstention: Score;
  evidenceInPromptRate: number | null;
  /** Mean share of answer rounds that reached the memory section, over measured questions. */
  answerRoundRecall: number | null;
  memorySearchRate: number | null;
  incomplete: number;
  totalTokens: number;
  medianTokens: number | null;
  /** Median input tokens per question: how much each request carried. */
  medianInputTokens: number | null;
  /** Summed estimated spend, or null when any question's price was unknown. */
  costUsd: number | null;
  medianDurationMs: number | null;
  p90DurationMs: number | null;
}>;

function score(outcomes: ReadonlyArray<LongMemEvalOutcome>): Score {
  const correct = outcomes.filter((outcome) => outcome.correct).length;
  return {
    questions: outcomes.length,
    correct,
    accuracy: outcomes.length > 0 ? correct / outcomes.length : null,
  };
}

function rate(values: ReadonlyArray<boolean>): number | null {
  return values.length > 0 ? values.filter(Boolean).length / values.length : null;
}

function percentile(values: ReadonlyArray<number>, fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
}

/** The answer the scenario's last turn delivered, or an empty answer when it gave none. */
export function longMemEvalHypothesis(result: E2EScenarioResult): string {
  return result.turnTraces[result.turnTraces.length - 1]?.finalAssistant?.text ?? '';
}

function roundIdsThatReachedModel(
  result: E2EScenarioResult,
  threadMessageIds: ReadonlySet<string>,
): Set<string> {
  return new Set([
    ...threadMessageIds,
    ...result.turnTraces.flatMap((turn) =>
      turn.memoryPrompt.builds.flatMap((build) => build.turnIds),
    ),
  ]);
}

/** How many distinct memories the requests' memory sections showed. */
export function memoryItemsShown(result: E2EScenarioResult): number {
  return new Set(
    result.turnTraces.flatMap((turn) => turn.memoryPrompt.builds.flatMap((build) => build.itemIds)),
  ).size;
}

/**
 * Whether a round from an evidence session reached the model: in any request's memory section,
 * or among the history messages the thread carried (`threadMessageIds`).
 */
export function evidenceReachedMemoryPrompt(
  instance: LongMemEvalInstance,
  result: E2EScenarioResult,
  threadMessageIds: ReadonlySet<string> = new Set(),
): boolean | null {
  if (instance.evidenceSessionIds.length === 0) return null;
  const evidence = new Set(instance.evidenceSessionIds);
  return [...roundIdsThatReachedModel(result, threadMessageIds)].some((id) => {
    const sessionIndex = sessionIndexOfHistoryMessage(id);
    const session = sessionIndex === null ? undefined : instance.sessions[sessionIndex];
    return session !== undefined && evidence.has(session.id);
  });
}

/**
 * The rounds that hold the answer, each named by the history id of its user message (the id
 * the memory section reports a past round by). An answer in a reply belongs to the round of
 * the user message before it.
 */
function answerRoundIds(instance: LongMemEvalInstance): Set<string> {
  const ids = new Set<string>();
  instance.sessions.forEach((session, sessionIndex) => {
    let roundUserIndex: number | null = null;
    session.turns.forEach((turn, turnIndex) => {
      if (turn.role === 'user') roundUserIndex = turnIndex;
      if (turn.hasAnswer && roundUserIndex !== null) {
        ids.add(historyMessageId(sessionIndex, roundUserIndex));
      }
    });
  });
  return ids;
}

/** Share of the rounds that hold the answer that reached the model, either way. */
export function answerRoundRecall(
  instance: LongMemEvalInstance,
  result: E2EScenarioResult,
  threadMessageIds: ReadonlySet<string> = new Set(),
): number | null {
  const answerRounds = answerRoundIds(instance);
  if (answerRounds.size === 0) return null;
  const reached = roundIdsThatReachedModel(result, threadMessageIds);
  return [...answerRounds].filter((id) => reached.has(id)).length / answerRounds.size;
}

function mean(values: ReadonlyArray<number>): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizeLongMemEval(
  outcomes: ReadonlyArray<LongMemEvalOutcome>,
): LongMemEvalSummary {
  const arms = new Set(outcomes.map((outcome) => outcome.arm));
  const byType = Object.fromEntries(
    LONGMEMEVAL_QUESTION_TYPES.map((type) => [
      type,
      score(outcomes.filter((outcome) => outcome.questionType === type)),
    ]),
  ) as Record<LongMemEvalQuestionType, Score>;
  const typeAccuracies = Object.values(byType)
    .map((typeScore) => typeScore.accuracy)
    .filter((accuracy): accuracy is number => accuracy !== null);
  const tokens = outcomes.map((outcome) => outcome.totalTokens);
  const durations = outcomes.map((outcome) => outcome.durationMs);
  return {
    arm: arms.size === 1 ? [...arms][0]! : 'mixed',
    overall: score(outcomes),
    taskAveragedAccuracy:
      typeAccuracies.length > 0
        ? typeAccuracies.reduce((sum, accuracy) => sum + accuracy, 0) / typeAccuracies.length
        : null,
    byType,
    abstention: score(outcomes.filter((outcome) => outcome.abstention)),
    evidenceInPromptRate: rate(
      outcomes
        .map((outcome) => outcome.evidenceInPrompt)
        .filter((value): value is boolean => value !== null),
    ),
    answerRoundRecall: mean(
      outcomes
        .map((outcome) => outcome.answerRoundRecall)
        .filter((value): value is number => value !== null),
    ),
    memorySearchRate: rate(outcomes.map((outcome) => outcome.memorySearchCalls > 0)),
    incomplete: outcomes.filter((outcome) => !outcome.completed).length,
    totalTokens: tokens.reduce((sum, value) => sum + value, 0),
    medianTokens: percentile(tokens, 0.5),
    medianInputTokens: percentile(
      outcomes.map((outcome) => outcome.inputTokens),
      0.5,
    ),
    costUsd: outcomes.every((outcome) => outcome.costUsd !== null)
      ? outcomes.reduce((sum, outcome) => sum + (outcome.costUsd ?? 0), 0)
      : null,
    medianDurationMs: percentile(durations, 0.5),
    p90DurationMs: percentile(durations, 0.9),
  };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

export function formatLongMemEvalSummary(summary: LongMemEvalSummary): string {
  const lines = [
    `LongMemEval (${summary.arm}): ${summary.overall.correct}/${summary.overall.questions} = ${percent(summary.overall.accuracy)}, task-averaged ${percent(summary.taskAveragedAccuracy)}`,
    ...LONGMEMEVAL_QUESTION_TYPES.map((type) => {
      const typeScore = summary.byType[type];
      return `  ${type}: ${typeScore.correct}/${typeScore.questions} = ${percent(typeScore.accuracy)}`;
    }),
    `  abstention: ${summary.abstention.correct}/${summary.abstention.questions} = ${percent(summary.abstention.accuracy)}`,
    `  evidence reached the model: ${percent(summary.evidenceInPromptRate)}; answer rounds that reached it: ${percent(summary.answerRoundRecall)}; memory_search used: ${percent(summary.memorySearchRate)}; incomplete: ${summary.incomplete}`,
    `  tokens: ${summary.totalTokens} total, ${summary.medianTokens ?? 'n/a'} median, ${summary.medianInputTokens ?? 'n/a'} median input; cost ${summary.costUsd === null ? 'n/a' : `$${summary.costUsd.toFixed(4)}`}; duration median ${summary.medianDurationMs ?? 'n/a'} ms, p90 ${summary.p90DurationMs ?? 'n/a'} ms`,
  ];
  return lines.join('\n');
}
