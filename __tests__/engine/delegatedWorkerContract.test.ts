import { buildGraphDelegatedWorkerContract } from '../../src/engine/graph/delegatedWorkerContract';
import { createGoal } from '../../src/engine/goals/types';

describe('buildGraphDelegatedWorkerContract', () => {
  it('builds the worker prompt from its workstream and the supervisor handoff', () => {
    const goal = createGoal({
      id: 'local-report',
      title: 'Create local report',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      now: 1,
    });

    const contract = buildGraphDelegatedWorkerContract({
      normalizedPrompt: 'Prepare the report.',
      goalId: goal.id,
      goals: [goal],
    });

    expect(contract.source).toBe('graph');
    expect(contract.workstreamId).toBe('local-report');
    expect(contract.prompt).toContain('Supervisor handoff:\nPrepare the report.');
    expect(contract.prompt).toContain('copy them exactly from inspected evidence');
    expect(contract.prompt).toContain('do not normalize, reconstruct, or invent paths');
    expect(contract.prompt).not.toMatch(/user constraint|Inherited user text/i);
  });

  it('passes the supervisor prompt through when no workstream scopes the worker', () => {
    expect(
      buildGraphDelegatedWorkerContract({ normalizedPrompt: 'Prepare the report.', goals: [] }),
    ).toEqual({ prompt: 'Prepare the report.', source: 'model', configuredTools: undefined });
  });
});
