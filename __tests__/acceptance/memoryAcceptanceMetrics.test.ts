jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { evaluateMemoryRecallOutcomes } from '../../src/acceptance/acceptanceMetrics/evaluateMemoryMetrics';
import {
  evaluateMemoryChitchatIngestionMetricOutcomes,
  isMemoryChitchatIngestionMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateMemoryChitchatIngestionMetrics';
import {
  evaluateGoalTaskUnificationMetricOutcomes,
  isGoalTaskUnificationMetricsPassing,
} from '../../src/acceptance/acceptanceMetrics/evaluateGoalTaskUnificationMetrics';
import { formatAcceptanceMetricEvaluation } from '../../src/acceptance/acceptanceMetrics/formatReport';
import { MEMORY_RECALL_FIXTURES } from '../../src/acceptance/acceptanceMetrics/memoryRecallFixtures';
import { runMemoryRecallScenario } from '../../src/acceptance/acceptanceMetrics/runMemoryRecallScenario';
import { MEMORY_RECALL_MIN_PASS_RATE } from '../../src/acceptance/acceptanceMetrics/thresholds';
import { MEMORY_CORRECTION_FIXTURES } from '../../src/acceptance/acceptanceMetrics/memoryCorrectionFixtures';
import { evaluateMemoryCorrectionFixture } from '../../src/acceptance/acceptanceMetrics/evaluateMemoryCorrectionFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  closeMemoryDb();
});

describe('quality memory metrics harness', () => {
  it('versions grounded multilingual corrections and rejects a hypothetical control', async () => {
    const outcomes = [];
    for (const [index, fixture] of MEMORY_CORRECTION_FIXTURES.entries()) {
      outcomes.push(await evaluateMemoryCorrectionFixture(fixture, 1_000 + index * 100));
    }
    expect(outcomes).toEqual(
      MEMORY_CORRECTION_FIXTURES.map((fixture) =>
        expect.objectContaining({ fixtureId: fixture.id, passed: true }),
      ),
    );
  });

  it('meets the 3-turn interdependent recall threshold across fixtures', async () => {
    const outcomes = [];
    for (const [index, fixture] of MEMORY_RECALL_FIXTURES.entries()) {
      outcomes.push(await runMemoryRecallScenario(fixture, 100 + index * 100));
    }

    const evaluation = evaluateMemoryRecallOutcomes(outcomes);
    if (!evaluation.passed) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }

    const summary = evaluation.summaries[0];
    expect(summary.passRate).toBeGreaterThanOrEqual(MEMORY_RECALL_MIN_PASS_RATE);
    expect(evaluation.passed).toBe(true);
  });

  it('persists episode and scoped focus after chitchat ingestion without memory_remember', async () => {
    const evaluation = await evaluateMemoryChitchatIngestionMetricOutcomes();
    if (!isMemoryChitchatIngestionMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }
    expect(evaluation.passed).toBe(true);
  });

  it('scopes task_stack titles and session recall to the active graph goal', async () => {
    const evaluation = await evaluateGoalTaskUnificationMetricOutcomes();
    if (!isGoalTaskUnificationMetricsPassing(evaluation)) {
      console.error(formatAcceptanceMetricEvaluation(evaluation));
    }
    expect(evaluation.passed).toBe(true);
  });
});
