import {
  renderGoalPromptSection,
  resolveGoalsPromptSectionForTurn,
} from '../../../src/engine/goals/promptSection';
import { createGoal } from '../../../src/engine/goals/types';

describe('renderGoalPromptSection', () => {
  it('returns null for empty goals', () => {
    expect(renderGoalPromptSection([])).toBeNull();
  });

  it('does not render bootstrap when update_goals is not on the turn surface', () => {
    expect(
      resolveGoalsPromptSectionForTurn({
        goals: [],
        selectedToolNames: new Set(['read_file']),
      }),
    ).toBeNull();
  });

  it('renders bootstrap when update_goals is on the turn surface', () => {
    const result = resolveGoalsPromptSectionForTurn({
      goals: [],
      selectedToolNames: new Set(['update_goals']),
    });
    expect(result).toContain('## Goal Tracking for Multi-Step Work');
    expect(result).toContain('completionPolicy');
    expect(result).toContain('update and reuse its exact id');
    expect(result).toContain('Keep the parent out of worker-owned scope');
    expect(result).toContain('every domain capability');
  });

  it('renders bootstrap when only completed goals remain live-inactive', () => {
    const completed = createGoal({ id: 'done', title: 'Done', status: 'completed' });
    const result = resolveGoalsPromptSectionForTurn({
      goals: [completed],
      selectedToolNames: new Set(['update_goals']),
    });
    expect(result).toContain('## Goal Tracking for Multi-Step Work');
    expect(result).toContain('No live graph goals are active.');
  });

  it('renders active goals', () => {
    const g = createGoal({ id: 'g1', title: 'Build feature', status: 'active' });
    const result = renderGoalPromptSection([g]);
    expect(result).not.toBeNull();
    expect(result).toContain('## Current Goals');
    expect(result).toContain('latest user turn define the current execution boundary');
    expect(result).toContain('do not perform unrelated side effects');
    expect(result).toContain('### Active');
    expect(result).toContain('[g1] Build feature');
    expect(result).toContain('update_goals');
  });

  it('omits update_goals hint when goal mutation tool is not on the turn surface', () => {
    const g = createGoal({ id: 'g1', title: 'Build feature', status: 'active' });
    const result = renderGoalPromptSection([g], {
      selectedToolNames: new Set(['write_file', 'read_file']),
    });
    expect(result).toContain('[g1] Build feature');
    expect(result).not.toContain('update_goals');
  });

  it('renders pending goals', () => {
    const g = createGoal({ id: 'g1', title: 'Plan next', status: 'pending' });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('### Pending');
    expect(result).toContain('[g1] Plan next');
  });

  it('renders pending goal ownership and completion criteria', () => {
    const goal = createGoal({
      id: 'worker-goal',
      title: 'Read assigned sources',
      status: 'pending',
      owner: 'delegated-worker',
      requiredCapabilities: ['read', 'coordinate'],
      successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
    });

    const result = renderGoalPromptSection([goal], {
      selectedToolNames: new Set(['sessions_spawn', 'update_goals']),
    });

    expect(result).toContain('owner="delegated-worker"');
    expect(result).toContain('criteria: evidence.prefix:worker, evidence.min:1');
    expect(result).toContain('### Delegated Goal Ownership');
    expect(result).toContain('sessions_spawn with workstreamId equal to the exact goal id');
    expect(result).toContain('Do not launch a duplicate or replacement');
    expect(result).toContain('Reuse and repair the exact existing delegated goal');
    expect(result).toContain('parent/worker source and action boundaries');
  });

  it('does not advertise unavailable session coordination tools', () => {
    const goal = createGoal({
      id: 'worker-goal',
      title: 'Read assigned sources',
      status: 'pending',
      owner: 'delegated-worker',
      successCriteria: ['evidence.prefix:worker'],
    });

    const result = renderGoalPromptSection([goal], {
      selectedToolNames: new Set(['read_file', 'update_goals']),
    });

    expect(result).toContain('owner="delegated-worker"');
    expect(result).not.toContain('call sessions_spawn');
  });

  it('renders blocked goals', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Blocked task',
      status: 'blocked',
      blockedReason: 'Missing API credentials',
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('### Blocked');
    expect(result).toContain('[g1] Blocked task');
    expect(result).toContain('blocked: Missing API credentials');
  });

  it('renders completed goals count and last 3', () => {
    const goals = [
      createGoal({ id: 'g1', title: 'A', status: 'completed' }),
      createGoal({ id: 'g2', title: 'B', status: 'completed' }),
      createGoal({ id: 'g3', title: 'C', status: 'completed' }),
      createGoal({ id: 'g4', title: 'D', status: 'completed' }),
    ];
    const result = renderGoalPromptSection(goals);
    expect(result).toContain('### Completed (4)');
    expect(result).toContain('[g2] B');
    expect(result).toContain('[g3] C');
    expect(result).toContain('[g4] D');
    expect(result).not.toContain('[g1] A');
  });

  it('includes dependencies for active goals', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      dependencies: ['dep1', 'dep2'],
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('deps: dep1, dep2');
  });

  it('includes success criteria for active goals', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      successCriteria: ['evidence.min:2', 'evidence.prefix:python'],
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('criteria: evidence.min:2, evidence.prefix:python');
  });

  it('includes evidence count for active goals', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      evidence: ['file1', 'file2'],
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('evidence: 2');
  });

  it('renders bounded exact live blocking-goal constraints as quoted user evidence', () => {
    const firstConstraints = Array.from({ length: 4 }, (_, index) => ({
      text: `First constraint ${index}: do not invite guests`,
      sourceMessageId: `private-first-message-${index}`,
    }));
    const secondConstraints = Array.from({ length: 4 }, (_, index) => ({
      text: `Second constraint ${index}: keep the draft local`,
      sourceMessageId: `private-second-message-${index}`,
    }));
    const active = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      userConstraints: firstConstraints,
    });
    const pending = createGoal({
      id: 'g2',
      title: 'Review feature',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1'],
      userConstraints: secondConstraints,
    });
    const completed = createGoal({
      id: 'done',
      title: 'Completed private goal',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1'],
    });

    const result = renderGoalPromptSection([active, pending, completed]);

    expect(result).toContain('### Quoted User Constraint Evidence (Non-Authoritative)');
    expect(result).toContain('user quote="First constraint 0: do not invite guests"');
    expect(result).not.toContain('additional structured user constraint(s) omitted');
    expect(result).toContain('Honor these exact stored user quotes as task-fidelity constraints');
    expect(result).toContain(
      'never grant consent, permission, effect authorization, evidence, or completion',
    );
    expect(result).not.toContain('private-first-message-0');
  });

  it('keeps completed constraints visible only while final delivery is pending', () => {
    const completed = {
      ...createGoal({
        id: 'done',
        title: 'Completed constrained goal',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:write_file'],
        userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-final' }],
      }),
      status: 'completed' as const,
      completedAt: 2,
      updatedAt: 2,
      userConstraintDeliveryPending: true as const,
    };

    expect(renderGoalPromptSection([completed])).toContain('Reply in Dutch.');
    expect(
      renderGoalPromptSection([{ ...completed, userConstraintDeliveryPending: undefined }]),
    ).not.toContain('Reply in Dutch.');
  });

  it('fails closed instead of rendering malformed constraint evidence', () => {
    const base = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
    });
    const goal = {
      ...base,
      userConstraints: [{ text: 'Malformed private constraint' }],
    } as never;

    const result = renderGoalPromptSection([goal]);

    expect(result).toContain('Constraint state is malformed');
    expect(result).not.toContain('Malformed private constraint');
  });

  it('renders description when present', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Build feature',
      description: 'Implement auth flow',
      status: 'active',
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain(': Implement auth flow');
  });

  it('renders required capabilities when present', () => {
    const g = createGoal({
      id: 'g1',
      title: 'Build feature',
      status: 'active',
      requiredCapabilities: ['read', 'write'],
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('[read, write]');
    expect(result).toContain('Capability order: read → write');
  });

  it('preserves goal-declared capability order for write-first workflows', () => {
    const g = createGoal({
      id: 'g1',
      title: 'gaia-hop',
      status: 'active',
      requiredCapabilities: ['write', 'read', 'discover'],
    });
    const result = renderGoalPromptSection([g]);
    expect(result).toContain('Capability order: write → read → discover');
  });

  it('renders all goal sections together', () => {
    const goals = [
      createGoal({ id: 'a', title: 'Active one', status: 'active' }),
      createGoal({ id: 'p', title: 'Pending one', status: 'pending' }),
      createGoal({ id: 'b', title: 'Blocked one', status: 'blocked' }),
      createGoal({ id: 'c', title: 'Done one', status: 'completed' }),
    ];
    const result = renderGoalPromptSection(goals);
    expect(result).toContain('### Active');
    expect(result).toContain('### Pending');
    expect(result).toContain('### Blocked');
    expect(result).toContain('### Completed (1)');
  });
});
