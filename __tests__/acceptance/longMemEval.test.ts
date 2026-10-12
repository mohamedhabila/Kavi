jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  parseLongMemEvalDate,
  parseLongMemEvalInstance,
  selectLongMemEvalSubset,
  type LongMemEvalInstance,
} from '../../src/acceptance/longMemEval/longMemEvalDataset';
import {
  buildLongMemEvalJudgePrompt,
  parseLongMemEvalJudgeLabel,
} from '../../src/acceptance/longMemEval/longMemEvalJudge';
import {
  evidenceReachedMemoryPrompt,
  formatLongMemEvalSummary,
  summarizeLongMemEval,
  type LongMemEvalOutcome,
} from '../../src/acceptance/longMemEval/longMemEvalReport';
import {
  buildLongMemEvalHistoryMessages,
  buildLongMemEvalScenario,
  indexLongMemEvalHistory,
} from '../../src/acceptance/longMemEval/longMemEvalScenario';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { closeMemoryDb } from '../../src/services/memory/database';
import { buildMemoryPromptSection } from '../../src/services/memory/core/memoryPrompt';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { installClockOffset } from '../helpers/clockOffset';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function rawInstance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    question_id: 'q-1',
    question_type: 'single-session-user',
    question: 'Where did I go hiking last month?',
    answer: 'Mount Rainier',
    question_date: '2023/05/30 (Tue) 23:40',
    haystack_session_ids: ['s-later', 's-evidence'],
    haystack_dates: ['2023/05/20 (Sat) 10:00', '2023/04/12 (Wed) 09:15'],
    haystack_sessions: [
      [
        { role: 'user', content: 'Any tips for sourdough?' },
        { role: 'assistant', content: 'Feed the starter twice a day.' },
      ],
      [
        { role: 'user', content: 'I just got back from hiking Mount Rainier!', has_answer: true },
        { role: 'assistant', content: 'That sounds amazing. How was the weather?' },
        { role: 'user', content: '   ' },
      ],
    ],
    answer_session_ids: ['s-evidence'],
    ...overrides,
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
});

afterAll(() => {
  closeMemoryDb();
});

describe('LongMemEval dataset', () => {
  it('reads an instance with its sessions in date order and blank turns dropped', () => {
    const instance = parseLongMemEvalInstance(rawInstance());

    expect(instance).toMatchObject({
      questionId: 'q-1',
      questionType: 'single-session-user',
      abstention: false,
      answer: 'Mount Rainier',
      askedAt: Date.UTC(2023, 4, 30, 23, 40),
      evidenceSessionIds: ['s-evidence'],
    });
    expect(instance.sessions.map((session) => session.id)).toEqual(['s-evidence', 's-later']);
    expect(instance.sessions[0]!.turns).toHaveLength(2);
  });

  it('marks unanswerable questions and keeps numeric answers as text', () => {
    expect(
      parseLongMemEvalInstance(rawInstance({ question_id: 'q-2_abs', answer: 3 })),
    ).toMatchObject({ abstention: true, answer: '3' });
  });

  it.each([
    [{ question_type: 'open-ended' }, 'question_type'],
    [{ question_date: '2023-05-30' }, 'date is malformed'],
    [{ question_date: '2023/02/30 (Thu) 10:00' }, 'does not exist'],
    [{ haystack_dates: ['2023/05/20 (Sat) 10:00'] }, 'mismatched'],
    [{ haystack_sessions: [[{ role: 'system', content: 'x' }], []] }, 'role'],
    [{ answer_session_ids: [7] }, 'answer_session_ids'],
    [{ question: '' }, 'question'],
  ])('rejects a malformed instance %j', (overrides, message) => {
    expect(() => parseLongMemEvalInstance(rawInstance(overrides))).toThrow(message);
  });

  it('parses dates as UTC wall time', () => {
    expect(parseLongMemEvalDate('2024/02/29 (Thu) 00:05')).toBe(Date.UTC(2024, 1, 29, 0, 5));
  });

  it('draws the same per-type subset whatever order the file lists questions in', () => {
    const instances = ['a', 'b', 'c', 'd'].flatMap((suffix) => [
      parseLongMemEvalInstance(rawInstance({ question_id: `user-${suffix}` })),
      parseLongMemEvalInstance(
        rawInstance({ question_id: `update-${suffix}`, question_type: 'knowledge-update' }),
      ),
    ]);

    const subset = selectLongMemEvalSubset(instances, 2);
    const reversed = selectLongMemEvalSubset([...instances].reverse(), 2);

    expect(subset).toHaveLength(4);
    expect(subset.map((instance) => instance.questionId)).toEqual(
      reversed.map((instance) => instance.questionId),
    );
    expect(subset.filter((instance) => instance.questionType === 'knowledge-update')).toHaveLength(
      2,
    );
    expect(() => selectLongMemEvalSubset(instances, 0)).toThrow('positive integer');
  });
});

describe('LongMemEval judge', () => {
  it('fills the reference prompt for the question type', () => {
    const instance = parseLongMemEvalInstance(rawInstance({ question_type: 'temporal-reasoning' }));

    const prompt = buildLongMemEvalJudgePrompt(instance, 'You hiked Mount Rainier {}.');

    expect(prompt).toContain('do not penalize off-by-one errors');
    expect(prompt).toContain('Question: Where did I go hiking last month?');
    expect(prompt).toContain('Correct Answer: Mount Rainier');
    expect(prompt).toContain('Model Response: You hiked Mount Rainier {}.');
  });

  it('asks whether an unanswerable question was recognised as such', () => {
    const instance = parseLongMemEvalInstance(rawInstance({ question_id: 'q-3_abs' }));

    expect(buildLongMemEvalJudgePrompt(instance, 'I do not know.')).toContain(
      'Does the model correctly identify the question as unanswerable?',
    );
  });

  it.each([
    ['yes', true],
    [' Yes.', true],
    ['no', false],
    ['', false],
  ])('reads %j as %s', (reply, expected) => {
    expect(parseLongMemEvalJudgeLabel(reply)).toBe(expected);
  });
});

describe('LongMemEval as a Kavi conversation', () => {
  it('puts the whole history in the thread only for the context arm', () => {
    const instance = parseLongMemEvalInstance(rawInstance());

    expect(buildLongMemEvalScenario(instance, 'context').initialMessages).toHaveLength(4);
    expect(buildLongMemEvalScenario(instance, 'memory')).not.toHaveProperty('initialMessages');
    expect(buildLongMemEvalScenario(instance, 'memory')).toMatchObject({
      prompt: 'Where did I go hiking last month?',
      execution: { route: 'production_auto' },
    });
  });

  it('indexes each round on its session date, so the memory section recalls the evidence', () => {
    const instance = parseLongMemEvalInstance(rawInstance());

    expect(indexLongMemEvalHistory('thread-1', buildLongMemEvalHistoryMessages(instance))).toBe(2);
    const section = buildMemoryPromptSection({
      conversationId: 'thread-1',
      latestUserMessage: 'Where did I go hiking last month?',
      inRequestUserMessageIds: [],
    });

    expect(section?.text).toContain('2023-04-12');
    expect(section?.text).toContain('Mount Rainier');
    expect(section?.turnIds).toContain('lme-0-0');
  });
});

function outcome(overrides: Partial<LongMemEvalOutcome>): LongMemEvalOutcome {
  return {
    questionId: 'q',
    questionType: 'single-session-user',
    abstention: false,
    arm: 'memory',
    hypothesis: 'answer',
    correct: true,
    judgeReply: 'yes',
    completed: true,
    durationMs: 1_000,
    totalTokens: 100,
    costUsd: 0.001,
    memorySearchCalls: 0,
    evidenceInPrompt: true,
    errors: [],
    ...overrides,
  };
}

describe('LongMemEval results', () => {
  it('detects whether an evidence round reached the memory section', () => {
    const instance: LongMemEvalInstance = parseLongMemEvalInstance(rawInstance());
    const withTurns = (turnIds: string[]) =>
      ({
        turnTraces: [
          {
            memoryPrompt: {
              status: 'recorded',
              builds: [{ itemIds: [], turnIds, chars: 1, durationMs: 1 }],
            },
          },
        ],
      }) as unknown as E2EScenarioResult;

    expect(evidenceReachedMemoryPrompt(instance, withTurns(['lme-0-0']))).toBe(true);
    expect(evidenceReachedMemoryPrompt(instance, withTurns(['lme-1-0']))).toBe(false);
    expect(
      evidenceReachedMemoryPrompt(
        parseLongMemEvalInstance(rawInstance({ answer_session_ids: [] })),
        withTurns(['lme-0-0']),
      ),
    ).toBeNull();
  });

  it('reports overall and task-averaged accuracy, abstention, retrieval and spend', () => {
    const summary = summarizeLongMemEval([
      outcome({ questionType: 'single-session-user', correct: true }),
      outcome({ questionType: 'single-session-user', correct: false, evidenceInPrompt: false }),
      outcome({
        questionType: 'knowledge-update',
        correct: true,
        abstention: true,
        memorySearchCalls: 2,
        evidenceInPrompt: null,
        durationMs: 3_000,
      }),
    ]);

    expect(summary).toMatchObject({
      arm: 'memory',
      overall: { questions: 3, correct: 2 },
      taskAveragedAccuracy: 0.75,
      abstention: { questions: 1, correct: 1, accuracy: 1 },
      evidenceInPromptRate: 0.5,
      memorySearchRate: 1 / 3,
      incomplete: 0,
      totalTokens: 300,
      medianDurationMs: 1_000,
    });
    expect(summary.costUsd).toBeCloseTo(0.003);
    expect(summary.byType['multi-session']).toEqual({ questions: 0, correct: 0, accuracy: null });
    expect(formatLongMemEvalSummary(summary)).toContain('LongMemEval (memory): 2/3 = 66.7%');
  });

  it('leaves the spend unknown when a price was unknown', () => {
    expect(summarizeLongMemEval([outcome({ costUsd: null })]).costUsd).toBeNull();
  });
});

describe('the question-date clock', () => {
  it('moves now to the question date while dates built from values stay as given', () => {
    const askedAt = Date.UTC(2023, 4, 30, 23, 40);
    const restore = installClockOffset(askedAt - Date.now());
    try {
      expect(Math.abs(Date.now() - askedAt)).toBeLessThan(1_000);
      expect(Math.abs(new Date().getTime() - askedAt)).toBeLessThan(1_000);
      expect(new Date(0).getTime()).toBe(0);
      expect(new Date()).toBeInstanceOf(Date);
    } finally {
      restore();
    }
    expect(Math.abs(Date.now() - askedAt)).toBeGreaterThan(1_000);
  });

  it('refuses an offset that is not a number', () => {
    expect(() => installClockOffset(Number.NaN)).toThrow('finite');
  });
});
