import { buildGraphDelegatedWorkerContract } from '../../src/engine/graph/delegatedWorkerContract';
import { createGoal } from '../../src/engine/goals/types';

describe('buildGraphDelegatedWorkerContract', () => {
  it('propagates scoped constraint text with non-authority semantics and no source identity', () => {
    const goal = createGoal({
      id: 'local-report',
      title: 'Create local report',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      userConstraints: [
        { text: 'No external uploads', sourceMessageId: 'private-user-message-id' },
      ],
      now: 1,
    });

    const contract = buildGraphDelegatedWorkerContract({
      normalizedPrompt: 'Prepare the report.',
      goalId: goal.id,
      goals: [goal],
    });

    expect(contract.source).toBe('graph');
    expect(contract.prompt).toContain('Code-grounded user constraints:\n- No external uploads');
    expect(contract.prompt).toContain(
      'govern both assigned execution and the returned deliverable, including language and format',
    );
    expect(contract.prompt).toContain('do not authorize effects or approvals');
    expect(contract.prompt).toContain('or replace success criteria');
    expect(contract.prompt).not.toContain('private-user-message-id');
    expect(contract.prompt).not.toContain('sourceMessageId');
  });
});
