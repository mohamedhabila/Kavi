import {
  buildStateBenchLearningArtifact,
  STATE_BENCH_DOMAINS,
  type StateBenchDomain,
  type StateBenchTrainingFile,
} from '../../benchmarks/state_bench/stateBenchTrainingArtifact';
import { retrieveExperienceLearnings } from '../../src/services/memory/experienceLearningArtifact';

function trajectory(tools: string[], done = true): string {
  return JSON.stringify({
    conversation: [
      { role: 'system', content: 'locked' },
      { role: 'user', content: 'Please complete the task.' },
      {
        role: 'assistant',
        content: 'Working on it.',
        tool_calls: tools.map((name) => ({
          name,
          arguments: { id: 'example' },
          result: {
            status: name.startsWith('cancel') ? 'cancelled' : 'ok',
            booking_id: 'example',
            refund_amount: 20,
          },
        })),
      },
      { role: 'user', content: done ? '[TASK_DONE]' : '[TASK_FAILED]' },
    ],
  });
}

function filesForDomain(domain: StateBenchDomain): StateBenchTrainingFile[] {
  const tools =
    domain === 'travel'
      ? ['get_booking', 'cancel_booking']
      : domain === 'customer_support'
        ? ['get_order', 'create_return']
        : ['search_products', 'add_to_cart'];
  return [1, 2, 3].map((index) => ({
    name: `${index}-${domain}.json`,
    content: trajectory(tools),
  }));
}

function fixtureFiles(): Record<StateBenchDomain, StateBenchTrainingFile[]> {
  return Object.fromEntries(
    STATE_BENCH_DOMAINS.map((domain) => [domain, filesForDomain(domain)]),
  ) as Record<StateBenchDomain, StateBenchTrainingFile[]>;
}

describe('STATE-Bench training-only artifact', () => {
  it('derives corroborated, domain-bound procedures without retaining raw trajectory values', () => {
    const artifact = buildStateBenchLearningArtifact({
      filesByDomain: fixtureFiles(),
      allowPartial: true,
    });

    expect(artifact.source).toEqual(
      expect.objectContaining({
        release: 'v0.8.0',
        commit: 'e2c8d7af51ef48fbbea51bb2ce1fb859af36b423',
        trainOnly: true,
      }),
    );
    expect(artifact.source.domains).toHaveLength(3);
    expect(artifact.diagnostics).toEqual(
      expect.objectContaining({
        trajectoryCount: 9,
        successfulTrajectoryCount: 9,
        failedTrajectoryCount: 0,
        toolCallCount: 18,
      }),
    );
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain('example');
    expect(serialized).not.toContain('Please complete the task');
    expect(serialized).toContain('transition:get_booking>cancel_booking');
    expect(serialized).toContain('field:refund_amount');
  });

  it('retrieves only learnings from the current benchmark domain', () => {
    const artifact = buildStateBenchLearningArtifact({
      filesByDomain: fixtureFiles(),
      allowPartial: true,
    });

    const learnings = retrieveExperienceLearnings({
      artifact: artifact.learning,
      domainId: 'travel',
      environmentId: 'state-bench-v0.8.0',
      query: 'Cancel my booking and calculate the refund',
      topK: 3,
    });

    expect(learnings.join('\n')).toContain('cancel_booking');
    expect(learnings.join('\n')).not.toContain('create_return');
    expect(learnings.join('\n')).not.toContain('add_to_cart');
  });

  it('fails closed on malformed tool calls and official source-count mismatches', () => {
    const malformed = fixtureFiles();
    malformed.travel[0] = {
      name: '1-travel.json',
      content: JSON.stringify({
        conversation: [
          { role: 'assistant', tool_calls: [{ name: 'get_booking', arguments: 'bad' }] },
        ],
      }),
    };
    expect(() =>
      buildStateBenchLearningArtifact({ filesByDomain: malformed, allowPartial: true }),
    ).toThrow('state_bench_training_tool_call_invalid');
    expect(() => buildStateBenchLearningArtifact({ filesByDomain: fixtureFiles() })).toThrow(
      'state_bench_travel_official_train_count_invalid',
    );
  });

  it('records failed trajectories as direct negative evidence instead of success', () => {
    const files = fixtureFiles();
    files.travel = [1, 2, 3].map((index) => ({
      name: `${index}-travel.json`,
      content: trajectory(['get_booking', 'cancel_booking'], false),
    }));
    const artifact = buildStateBenchLearningArtifact({ filesByDomain: files, allowPartial: true });
    const travelTransition = artifact.learning.records.find(
      (record) => record.procedureId === 'transition:get_booking>cancel_booking',
    );

    expect(artifact.diagnostics.failedTrajectoryCount).toBe(3);
    expect(travelTransition?.recommendation).toBe('avoid');
  });
});
