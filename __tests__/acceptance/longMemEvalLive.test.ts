// ---------------------------------------------------------------------------
// LongMemEval — live benchmark run (opt-in)
// ---------------------------------------------------------------------------
// Gated: RUN_LONGMEMEVAL=1, LONGMEMEVAL_DATA=<path to a LongMemEval JSON file> and the
// selected E2E provider's credentials. Optional: LONGMEMEVAL_ARM (memory | context | window,
// default memory), LONGMEMEVAL_WINDOW_TOKENS (the window arm's raw-history budget, default
// 32000), LONGMEMEVAL_PER_TYPE (default 10), LONGMEMEVAL_JUDGE_MODEL (default
// LongMemEval's reference judge), LONGMEMEVAL_OUT (results JSONL path). Run with TZ=UTC:
// LongMemEval's dates carry no zone and are read as UTC.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});
jest.mock('expo-notifications', () =>
  require('../../src/acceptance/e2eAgent/e2eNativeNotificationsModule').createE2ENotificationsModule(),
);

import fs from 'fs';
import path from 'path';
import {
  buildE2EProviderWithDiscoveredCatalog,
  shouldRunE2EAgentEval,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { runE2EScenario } from '../../src/acceptance/e2eAgent/scenarioRunner';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import {
  parseLongMemEvalInstance,
  selectLongMemEvalSubset,
  type LongMemEvalInstance,
} from '../../src/acceptance/longMemEval/longMemEvalDataset';
import {
  buildLongMemEvalJudgePrompt,
  LONGMEMEVAL_JUDGE_MAX_TOKENS,
  LONGMEMEVAL_REFERENCE_JUDGE_MODEL,
  parseLongMemEvalJudgeLabel,
} from '../../src/acceptance/longMemEval/longMemEvalJudge';
import {
  answerRoundRecall,
  evidenceReachedMemoryPrompt,
  formatLongMemEvalSummary,
  longMemEvalHypothesis,
  summarizeLongMemEval,
  type LongMemEvalOutcome,
} from '../../src/acceptance/longMemEval/longMemEvalReport';
import {
  buildLongMemEvalHistoryMessages,
  buildLongMemEvalScenario,
  indexLongMemEvalHistory,
  LONGMEMEVAL_ARMS,
  type LongMemEvalArm,
} from '../../src/acceptance/longMemEval/longMemEvalScenario';
import { LlmService } from '../../src/services/llm/LlmService';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { installClockOffset } from '../helpers/clockOffset';

const DATA_PATH = process.env.LONGMEMEVAL_DATA?.trim() ?? '';
const enabled =
  process.env.RUN_LONGMEMEVAL === '1' && DATA_PATH.length > 0 && shouldRunE2EAgentEval();
const describeLive = enabled ? describe : describe.skip;
const QUESTION_TIMEOUT_MS = 600_000;

function selectedArm(): LongMemEvalArm {
  const arm = process.env.LONGMEMEVAL_ARM?.trim() || 'memory';
  if (!LONGMEMEVAL_ARMS.includes(arm as LongMemEvalArm)) {
    throw new Error(`LONGMEMEVAL_ARM must be one of ${LONGMEMEVAL_ARMS.join(', ')}.`);
  }
  return arm as LongMemEvalArm;
}

function selectedWindowTokens(): number {
  const tokens = Number(process.env.LONGMEMEVAL_WINDOW_TOKENS?.trim() || '32000');
  if (!Number.isInteger(tokens) || tokens <= 0) {
    throw new Error('LONGMEMEVAL_WINDOW_TOKENS must be a positive integer.');
  }
  return tokens;
}

function selectedInstances(): LongMemEvalInstance[] {
  const perType = Number(process.env.LONGMEMEVAL_PER_TYPE?.trim() || '10');
  const parsed: unknown = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('LONGMEMEVAL_DATA must hold a JSON array.');
  return selectLongMemEvalSubset(parsed.map(parseLongMemEvalInstance), perType);
}

async function judgeAnswer(
  judge: LlmService,
  model: string,
  instance: LongMemEvalInstance,
  hypothesis: string,
): Promise<string> {
  const response = await judge.sendMessage(
    [{ role: 'user', content: buildLongMemEvalJudgePrompt(instance, hypothesis) }],
    { model, maxTokens: LONGMEMEVAL_JUDGE_MAX_TOKENS, temperature: 0 },
  );
  return String(response?.choices?.[0]?.message?.content ?? '');
}

describeLive('LongMemEval (live)', () => {
  // A skipped describe still runs its body, so nothing is read unless the run is opted in.
  const arm: LongMemEvalArm = enabled ? selectedArm() : 'memory';
  const windowTokens = enabled && arm === 'window' ? selectedWindowTokens() : 0;
  const instances = enabled ? selectedInstances() : [];
  const outPath =
    process.env.LONGMEMEVAL_OUT?.trim() || path.join('.artifacts', `longmemeval-${arm}.jsonl`);
  const judgeModel =
    process.env.LONGMEMEVAL_JUDGE_MODEL?.trim() || LONGMEMEVAL_REFERENCE_JUDGE_MODEL;
  const outcomes: LongMemEvalOutcome[] = [];
  let provider: LlmProviderConfig;
  let judge: LlmService;

  beforeAll(async () => {
    provider = await buildE2EProviderWithDiscoveredCatalog();
    judge = new LlmService({ ...provider, model: judgeModel });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, '');
  });

  beforeEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
  });

  afterEach(() => {
    resetE2EWorkspaceSandbox();
    teardownE2EMemorySandbox();
  });

  it('selects questions to answer', () => {
    expect(instances.length).toBeGreaterThan(0);
  });

  for (const instance of instances) {
    it(
      `answers ${instance.questionId} (${instance.questionType})`,
      async () => {
        const history = buildLongMemEvalHistoryMessages(instance);
        const restoreClock = installClockOffset(instance.askedAt - Date.now());
        const scenario = buildLongMemEvalScenario(instance, arm, windowTokens);
        const threadMessageIds = new Set(
          (scenario.initialMessages ?? []).map((message) => message.id),
        );
        let result;
        try {
          result = await runE2EScenario(scenario, {
            provider,
            ...(arm !== 'context'
              ? {
                  beforeTurns: ({ conversationId }: { conversationId: string }) => {
                    indexLongMemEvalHistory(conversationId, history);
                  },
                }
              : {}),
          });
        } finally {
          restoreClock();
        }
        const hypothesis = longMemEvalHypothesis(result);
        const judgeReply = await judgeAnswer(judge, judgeModel, instance, hypothesis);
        const outcome: LongMemEvalOutcome = {
          questionId: instance.questionId,
          questionType: instance.questionType,
          abstention: instance.abstention,
          arm,
          hypothesis,
          correct: parseLongMemEvalJudgeLabel(judgeReply),
          judgeReply,
          completed: result.completed,
          durationMs: result.durationMs,
          totalTokens: result.usage.totalTokens + result.memoryUsage.totalTokens,
          inputTokens: result.usage.inputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          costUsd: result.estimatedCost.usd,
          memorySearchCalls: result.toolCalls.filter((call) => call.name === 'memory_search')
            .length,
          evidenceInPrompt:
            arm === 'context'
              ? null
              : evidenceReachedMemoryPrompt(instance, result, threadMessageIds),
          answerRoundRecall:
            arm === 'context' ? null : answerRoundRecall(instance, result, threadMessageIds),
          errors: result.errors,
        };
        outcomes.push(outcome);
        fs.appendFileSync(outPath, `${JSON.stringify(outcome)}\n`);
        expect(hypothesis.length).toBeGreaterThan(0);
      },
      QUESTION_TIMEOUT_MS,
    );
  }

  afterAll(() => {
    teardownE2EMemorySandbox();
    console.log(`[longmemeval]\n${formatLongMemEvalSummary(summarizeLongMemEval(outcomes))}`);
  });
});
