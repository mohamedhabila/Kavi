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
  it('offers goal bootstrap when goals are empty', () => {
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

  it('requires structural setup for multi-step work without burdening single-step answers', () => {
    const section = renderGoalBootstrapPromptSection();
    expect(section).toContain('## Goal Tracking for Multi-Step Work');
    expect(section).toContain('multiple tool steps');
    expect(section).toContain('multiple deliverables');
    expect(section).toContain('explicit success conditions');
    expect(section).toContain('MUST establish the task');
    expect(section).toContain('genuinely single-step answer or observation');
    expect(section).toContain('initial incomplete blocking goal');
    expect(section).toContain('retainCurrentUserConstraint:true');
    expect(section).toContain('automatically retains');
    expect(section).toContain('survive compaction and recovery');
  });

  it('renders the required add contract during bootstrap', () => {
    const section = renderGoalBootstrapPromptSection();
    expect(section).toContain('completionPolicy');
    expect(section).toContain('successCriteria');
    expect(section).toContain('evidence.min:<n>');
    expect(section).toContain('"id":"stable-id"');
    expect(section).toContain('"name":"Visible name"');
    expect(section).toContain('evidence.artifact:<exact-workspace-relative-path>');
    expect(section).toContain('evidence.prefix:artifact is invalid');
    expect(section).not.toContain('"goals"');
    expect(section).toContain('natural-language labels');
  });
});
