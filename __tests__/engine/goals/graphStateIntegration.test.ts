import {
  applyGoalMutation,
  buildInitialGoalState,
} from '../../../src/engine/goals/graphState';
import { createGoal } from '../../../src/engine/goals/types';
import { renderGoalPromptSection } from '../../../src/engine/goals/promptSection';
import { buildToolDefinitions } from '../../../src/engine/tools/definitions';

describe('goal system integration', () => {
  it('update_goals tool is in the global tool definitions', () => {
    const tools = buildToolDefinitions();
    const updateGoals = tools.find((t) => t.name === 'update_goals');
    expect(updateGoals).toBeDefined();
    expect(updateGoals?.input_schema.type).toBe('object');
    expect(updateGoals?.strict).toBe(true);
  });

  it('update_goals is not duplicated in tool definitions', () => {
    const tools = buildToolDefinitions();
    const matches = tools.filter((t) => t.name === 'update_goals');
    expect(matches).toHaveLength(1);
  });

  it('renders prompt section for a realistic goal set', () => {
    const goals = [
      createGoal({ id: 'g1', title: 'Set up project', status: 'completed' }),
      createGoal({ id: 'g2', title: 'Implement auth', status: 'active', dependencies: ['g1'] }),
      createGoal({ id: 'g3', title: 'Write tests', status: 'pending', dependencies: ['g2'] }),
      createGoal({ id: 'g4', title: 'Deploy app', status: 'blocked', dependencies: ['g3'] }),
    ];
    const section = renderGoalPromptSection(goals);
    expect(section).not.toBeNull();
    expect(section).toContain('### Active');
    expect(section).toContain('Implement auth');
    expect(section).toContain('### Pending');
    expect(section).toContain('Write tests');
    expect(section).toContain('### Blocked');
    expect(section).toContain('Deploy app');
    expect(section).toContain('### Completed (1)');
    expect(section).toContain('update_goals');
  });

  it('applies a full workflow: add → activate → complete', () => {
    let goals = buildInitialGoalState().goals;

    // Add goals
    const addResult = applyGoalMutation(goals, {
      action: 'add',
      goals: [
        {
          id: 'setup',
          title: 'Set up project',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.prefix:write_file'],
        },
        {
          id: 'build',
          title: 'Build feature',
          completionPolicy: 'blocking',
          dependencies: ['setup'],
          successCriteria: ['evidence.prefix:read_file'],
        },
      ],
    });
    expect(addResult.errors).toHaveLength(0);
    goals = addResult.goals;
    expect(goals).toHaveLength(2);

    // Activate first goal (no dependencies)
    const activate1 = applyGoalMutation(goals, {
      action: 'activate',
      goals: [{ id: 'setup' }],
    });
    expect(activate1.errors).toHaveLength(0);
    goals = activate1.goals;
    expect(goals.find((g) => g.id === 'setup')?.status).toBe('active');

    // Complete first goal
    const complete1 = applyGoalMutation(goals, {
      action: 'complete',
      goals: [{ id: 'setup', evidence: ['write_file:done'] }],
    });
    expect(complete1.errors).toHaveLength(0);
    goals = complete1.goals;
    expect(goals.find((g) => g.id === 'setup')?.status).toBe('completed');

    // Activate second goal (dependency now completed)
    const activate2 = applyGoalMutation(goals, {
      action: 'activate',
      goals: [{ id: 'build' }],
    });
    expect(activate2.errors).toHaveLength(0);
    goals = activate2.goals;
    expect(goals.find((g) => g.id === 'build')?.status).toBe('active');
  });

  it('rejects premature blocks and removes completed goals with cascading effects', () => {
    let goals = buildInitialGoalState().goals;

    const addResult = applyGoalMutation(goals, {
      action: 'add',
      goals: [
        {
          id: 'a',
          title: 'A',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.prefix:write_file'],
        },
        { id: 'b', title: 'B', completionPolicy: 'persistent', dependencies: ['a'] },
        { id: 'c', title: 'C', completionPolicy: 'persistent', dependencies: ['b'] },
      ],
    });
    goals = addResult.goals;

    const activateA = applyGoalMutation(goals, {
      action: 'activate',
      goals: [{ id: 'a' }],
    });
    expect(activateA.errors).toHaveLength(0);
    goals = activateA.goals;

    const blockResult = applyGoalMutation(goals, {
      action: 'block',
      goals: [{ id: 'a', blockedReason: 'gate:a:evidence.prefix:write_file' }],
    });
    goals = blockResult.goals;
    expect(blockResult.errors[0]).toContain('Cannot block a blocking goal');
    expect(goals.find((g) => g.id === 'a')?.status).toBe('active');

    const completeA = applyGoalMutation(goals, {
      action: 'complete',
      goals: [{ id: 'a', evidence: ['write_file:ok'] }],
    });
    expect(completeA.errors).toHaveLength(0);
    goals = completeA.goals;

    const removeResult = applyGoalMutation(goals, {
      action: 'remove',
      goals: [{ id: 'a' }],
    });
    goals = removeResult.goals;
    expect(goals).toHaveLength(0);
  });

  it('accumulates evidence across mutations', () => {
    let goals = buildInitialGoalState().goals;

    const addResult = applyGoalMutation(goals, {
      action: 'add',
      goals: [
        {
          id: 'g1',
          title: 'Research topic',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.prefix:web_search', 'evidence.min:2'],
        },
      ],
    });
    goals = addResult.goals;

    const updateResult = applyGoalMutation(goals, {
      action: 'update',
      goals: [{ id: 'g1', evidence: ['web_search:result 1'] }],
    });
    goals = updateResult.goals;

    const activateResult = applyGoalMutation(goals, {
      action: 'activate',
      goals: [{ id: 'g1' }],
    });
    expect(activateResult.errors).toHaveLength(0);
    goals = activateResult.goals;

    const completeResult = applyGoalMutation(goals, {
      action: 'complete',
      goals: [{ id: 'g1', evidence: ['web_search:result 2'] }],
    });
    goals = completeResult.goals;

    const g1 = goals.find((g) => g.id === 'g1');
    expect(g1?.evidence).toEqual(['web_search:result 1', 'web_search:result 2']);
  });
});
