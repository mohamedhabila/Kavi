import {
  GOAL_BOOTSTRAP_TOOL_NAME,
  renderGoalBootstrapPromptSection,
  resolveGoalBootstrapState,
} from '../../../src/engine/goals/bootstrap';
import type { AgentGoal } from '../../../src/engine/goals/types';

const sampleGoal: AgentGoal = {
  id: 'goal-1',
  title: 'Ship release',
  status: 'active',
  dependencies: [],
  evidence: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('goals/bootstrap', () => {
  it('offers optional goal bootstrap when goals are empty', () => {
    expect(resolveGoalBootstrapState([]).shouldOfferGoalBootstrap).toBe(true);
  });

  it('does not offer goal bootstrap when live goals exist', () => {
    expect(resolveGoalBootstrapState([sampleGoal]).shouldOfferGoalBootstrap).toBe(false);
  });

  it('offers goal bootstrap when only completed goals exist', () => {
    expect(
      resolveGoalBootstrapState([{ ...sampleGoal, status: 'completed' }]).shouldOfferGoalBootstrap,
    ).toBe(true);
  });

  it('renders bootstrap prompt mentioning update_goals', () => {
    const section = renderGoalBootstrapPromptSection();
    expect(section).toContain(GOAL_BOOTSTRAP_TOOL_NAME);
    expect(section).toContain('add');
  });

  it('renders bootstrap as optional rather than mandatory graph setup', () => {
    const section = renderGoalBootstrapPromptSection();
    expect(section).toContain('## Optional Goal Tracking');
    expect(section).toContain('delegated workstreams');
    expect(section).toContain('declared goals with criteria/capabilities');
  });

  it('renders the required add contract during bootstrap', () => {
    const section = renderGoalBootstrapPromptSection();
    expect(section).toContain('completionPolicy');
    expect(section).toContain('successCriteria');
    expect(section).toContain('evidence.min:<n>');
    expect(section).toContain('"id":"stable-id"');
    expect(section).toContain('"name":"Visible name"');
    expect(section).not.toContain('"goals"');
    expect(section).toContain('natural-language labels');
  });
});
