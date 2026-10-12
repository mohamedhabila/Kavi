// ---------------------------------------------------------------------------
// Kavi — LongMemEval results
// ---------------------------------------------------------------------------
// One outcome per question and the summary the benchmark is judged by: accuracy overall
// and averaged over question types (LongMemEval reports both), per type, on unanswerable
// questions, how often an evidence session reached the memory section, how often the
// model searched memory, and what the run cost in tokens and time.
// ---------------------------------------------------------------------------

import {
  LONGMEMEVAL_QUESTION_TYPES,
  type LongMemEvalInstance,
  type LongMemEvalQuestionType,
} from './longMemEvalDataset';
import { sessionIndexOfHistoryMessage, type LongMemEvalArm } from './longMemEvalScenario';
import type { E2EScenarioResult } from '../e2eAgent/types';

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
  memorySearchCalls: number;
  /** Whether a round of an evidence session was in the memory section; null when not measured. */
  evidenceInPrompt: boolean | null;
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
  memorySearchRate: number | null;
  incomplete: number;
  totalTokens: number;
  medianTokens: number | null;
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

/** Whether the memory section of any request held a round from an evidence session. */
export function evidenceReachedMemoryPrompt(
  instance: LongMemEvalInstance,
  result: E2EScenarioResult,
): boolean | null {
  if (instance.evidenceSessionIds.length === 0) return null;
  const evidence = new Set(instance.evidenceSessionIds);
  return result.turnTraces.some((turn) =>
    turn.memoryPrompt.builds.some((build) =>
      build.turnIds.some((turnId) => {
        const sessionIndex = sessionIndexOfHistoryMessage(turnId);
        const session = sessionIndex === null ? undefined : instance.sessions[sessionIndex];
        return session !== undefined && evidence.has(session.id);
      }),
    ),
  );
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
    memorySearchRate: rate(outcomes.map((outcome) => outcome.memorySearchCalls > 0)),
    incomplete: outcomes.filter((outcome) => !outcome.completed).length,
    totalTokens: tokens.reduce((sum, value) => sum + value, 0),
    medianTokens: percentile(tokens, 0.5),
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
    `  evidence in memory section: ${percent(summary.evidenceInPromptRate)}; memory_search used: ${percent(summary.memorySearchRate)}; incomplete: ${summary.incomplete}`,
    `  tokens: ${summary.totalTokens} total, ${summary.medianTokens ?? 'n/a'} median; cost ${summary.costUsd === null ? 'n/a' : `$${summary.costUsd.toFixed(4)}`}; duration median ${summary.medianDurationMs ?? 'n/a'} ms, p90 ${summary.p90DurationMs ?? 'n/a'} ms`,
  ];
  return lines.join('\n');
}
