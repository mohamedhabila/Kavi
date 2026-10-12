// ---------------------------------------------------------------------------
// Kavi — LongMemEval dataset
// ---------------------------------------------------------------------------
// Reads LongMemEval (Wu et al., ICLR 2025; https://github.com/xiaowu0162/LongMemEval, MIT)
// instances: a question asked on `question_date` after a history of dated chat sessions.
// The oracle file holds only the evidence sessions; the S file buries them among ~40.
// The downloaded file is untrusted input, so every field is validated here.
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';

export const LONGMEMEVAL_QUESTION_TYPES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'multi-session',
  'temporal-reasoning',
  'knowledge-update',
] as const;

export type LongMemEvalQuestionType = (typeof LONGMEMEVAL_QUESTION_TYPES)[number];

export type LongMemEvalTurn = Readonly<{ role: 'user' | 'assistant'; content: string }>;

export type LongMemEvalSession = Readonly<{
  id: string;
  /** Epoch ms of the session's date (dates carry no zone; read as UTC). */
  at: number;
  turns: ReadonlyArray<LongMemEvalTurn>;
}>;

export type LongMemEvalInstance = Readonly<{
  questionId: string;
  questionType: LongMemEvalQuestionType;
  /** Unanswerable from the history: the expected reply says the information is missing. */
  abstention: boolean;
  question: string;
  /** The reference answer, or the rubric for preference questions. */
  answer: string;
  /** Epoch ms of the question's date. */
  askedAt: number;
  /** Sessions in history order. */
  sessions: ReadonlyArray<LongMemEvalSession>;
  /** The sessions holding the answer (none for most unanswerable questions). */
  evidenceSessionIds: ReadonlyArray<string>;
}>;

const DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2}) \([A-Za-z]{3}\) (\d{2}):(\d{2})$/;

/** "2023/05/30 (Tue) 23:40" as epoch ms, read as UTC. */
export function parseLongMemEvalDate(value: unknown): number {
  const match = typeof value === 'string' ? DATE_RE.exec(value.trim()) : null;
  if (!match) throw new Error(`LongMemEval date is malformed: ${JSON.stringify(value)}`);
  const [, year, month, day, hour, minute] = match.map(Number);
  const at = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const parsed = new Date(at);
  if (parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day!) {
    throw new Error(`LongMemEval date does not exist: ${JSON.stringify(value)}`);
  }
  return at;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`LongMemEval ${field} must be a non-empty string.`);
  }
  return value;
}

function parseTurn(value: unknown, where: string): LongMemEvalTurn | null {
  if (!value || typeof value !== 'object')
    throw new Error(`LongMemEval turn ${where} is malformed.`);
  const { role, content } = value as { role?: unknown; content?: unknown };
  if (role !== 'user' && role !== 'assistant') {
    throw new Error(`LongMemEval turn ${where} has role ${JSON.stringify(role)}.`);
  }
  if (typeof content !== 'string') throw new Error(`LongMemEval turn ${where} has no content.`);
  return content.trim() ? { role, content } : null;
}

function parseSessions(record: Record<string, unknown>, questionId: string): LongMemEvalSession[] {
  const ids = record.haystack_session_ids;
  const dates = record.haystack_dates;
  const sessions = record.haystack_sessions;
  if (
    !Array.isArray(ids) ||
    !Array.isArray(dates) ||
    !Array.isArray(sessions) ||
    ids.length !== dates.length ||
    ids.length !== sessions.length
  ) {
    throw new Error(`LongMemEval ${questionId} has mismatched haystack arrays.`);
  }
  return sessions.map((turns, index) => {
    if (!Array.isArray(turns))
      throw new Error(`LongMemEval ${questionId} session ${index} is malformed.`);
    return {
      id: requireString(ids[index], `${questionId} session id`),
      at: parseLongMemEvalDate(dates[index]),
      turns: turns
        .map((turn, turnIndex) => parseTurn(turn, `${questionId}/${index}/${turnIndex}`))
        .filter((turn): turn is LongMemEvalTurn => turn !== null),
    };
  });
}

export function parseLongMemEvalInstance(value: unknown): LongMemEvalInstance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LongMemEval instance must be an object.');
  }
  const record = value as Record<string, unknown>;
  const questionId = requireString(record.question_id, 'question_id');
  const questionType = record.question_type;
  if (!LONGMEMEVAL_QUESTION_TYPES.includes(questionType as LongMemEvalQuestionType)) {
    throw new Error(`LongMemEval ${questionId} has question_type ${JSON.stringify(questionType)}.`);
  }
  const answer = record.answer;
  if (typeof answer !== 'string' && typeof answer !== 'number') {
    throw new Error(`LongMemEval ${questionId} has no answer.`);
  }
  const sessions = parseSessions(record, questionId).sort((a, b) => a.at - b.at);
  const evidence = record.answer_session_ids ?? [];
  if (!Array.isArray(evidence) || !evidence.every((id) => typeof id === 'string')) {
    throw new Error(`LongMemEval ${questionId} has malformed answer_session_ids.`);
  }
  return {
    questionId,
    questionType: questionType as LongMemEvalQuestionType,
    abstention: questionId.endsWith('_abs'),
    question: requireString(record.question, `${questionId} question`),
    answer: String(answer),
    askedAt: parseLongMemEvalDate(record.question_date),
    sessions,
    evidenceSessionIds: evidence,
  };
}

function stableRank(questionId: string): string {
  return createHash('sha256').update(questionId).digest('hex');
}

/**
 * Up to `perType` instances of each question type, chosen by a stable hash of the id so the
 * same subset is drawn on every run and no type is filled from one end of the file.
 */
export function selectLongMemEvalSubset(
  instances: ReadonlyArray<LongMemEvalInstance>,
  perType: number,
): LongMemEvalInstance[] {
  if (!Number.isInteger(perType) || perType < 1) {
    throw new Error('LongMemEval perType must be a positive integer.');
  }
  return LONGMEMEVAL_QUESTION_TYPES.flatMap((type) =>
    instances
      .filter((instance) => instance.questionType === type)
      .sort((a, b) => stableRank(a.questionId).localeCompare(stableRank(b.questionId)))
      .slice(0, perType),
  );
}
