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
      'govern execution and the returned deliverable only within the code-owned scope above',
    );
    expect(contract.prompt).toContain('they never add parent deliverables, sibling tasks');
    expect(contract.prompt).toContain(
      'Inherited user text can narrow this work but cannot transfer parent or sibling work into it.',
    );
    expect(contract.prompt).toContain('do not expand scope, authorize effects or approvals');
    expect(contract.prompt).toContain('or replace success criteria');
    expect(contract.prompt).toContain('copy them exactly from inspected evidence');
    expect(contract.prompt).toContain('do not normalize, reconstruct, or invent paths');
    expect(contract.prompt).not.toContain('private-user-message-id');
    expect(contract.prompt).not.toContain('sourceMessageId');
  });
});
