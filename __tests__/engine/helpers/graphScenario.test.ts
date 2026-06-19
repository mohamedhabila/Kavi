import { createGoal } from '../../../src/engine/goals/types';
import {
  applyGraphScenarioEvents,
  buildGraphScenarioSnapshot,
  seedGraphGoals,
} from './graphScenario';

describe('graphScenario helper', () => {
  it('builds a lean snapshot without workflow fields', () => {
    const snapshot = buildGraphScenarioSnapshot(seedGraphGoals([
      createGoal({ id: 'g1', title: 'Plan trip' }),
    ]));
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot).not.toHaveProperty('workflowRoute');
    expect(snapshot).not.toHaveProperty('workflowProgress');
  });

  it('applies graph events through the scenario helper', () => {
    const snapshot = applyGraphScenarioEvents(buildGraphScenarioSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 1, toolNames: ['read_file'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: 'tc1', name: 'read_file' }],
      },
    ]);
    expect(snapshot.status).toBe('awaiting_tool_results');
    expect(snapshot.expectedToolCalls).toEqual([{ id: 'tc1', name: 'read_file' }]);
  });
});