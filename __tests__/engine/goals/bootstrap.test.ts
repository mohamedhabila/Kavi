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
    expect(section).toContain('"name":"Name"');
    // The bootstrap prose leads with general-purpose evidence, not a workspace-file
    // example — most tool calls record their own effect evidence automatically, and
    // evidence.tool: is what a model actually authors when it needs to name one.
    expect(section).toContain('Most tool calls record their own effect evidence automatically');
    expect(section).toContain('evidence.tool:<registered-tool-name>');
    expect(section).not.toContain('Workspace files require evidence.artifact');
    // The batched form is now what bootstrap teaches. Traced live: the provider's strict
    // mode rewrites every property into `required` with a nullable type, so the schema
    // carries no signal that `goals` is an alternative to the flat fields — the prompt and
    // the tool description are the only channels that survive intact, and the prompt
    // previously said "one goal mutation", which is what the model kept doing.
    expect(section).toContain('"goals"');
    expect(section).toContain('ONE call');
    expect(section).toContain('natural-language labels');
  });
});
