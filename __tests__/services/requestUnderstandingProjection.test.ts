import {
  appendRequestUnderstandingToRuntimeContext,
  normalizeRequestUnderstandingSnapshot,
  projectRequestUnderstanding,
  renderRequestUnderstandingPromptSection,
  shouldRenderRequestUnderstandingPrompt,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { createGoal } from '../../src/engine/goals/types';
import type {
  RequestFrame,
  RequiredRequestInformation,
} from '../../src/services/agents/requestFrame';
import type { AgentGoal } from '../../src/types/agentRun';
import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';

function frame(): RequestFrame {
  return buildGraphEntryRequestFrame({
    text: 'Private request text that must not be copied',
    attachmentCount: 0,
    mode: 'agentic',
    continuation: 'new',
  });
}

function unresolved(
  authority: RequiredRequestInformation['authority'],
  requiredFor: RequiredRequestInformation['requiredFor'] = 'execution',
): RequiredRequestInformation {
  return {
    key: `${authority}.${requiredFor}`,
    authority,
    requiredFor,
    resolution: 'unresolved',
  };
}

function blockingGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    ...createGoal({
      id: 'deliver-report',
      title: 'Deliver the report',
      status: 'active',
      completionPolicy: 'blocking',
      dependencies: ['collect-evidence'],
      requiredCapabilities: ['research'],
      requiredResourceKinds: ['web'],
      successCriteria: ['evidence.tool:write_file'],
      now: 1,
    }),
    ...overrides,
  };
}

describe('request understanding projection', () => {
  it('projects only structured request and graph state', () => {
    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [blockingGoal()],
    });

    expect(projection).toMatchObject({
      version: 2,
      integrity: 'valid',
      routing: {
        status: 'known',
        source: 'request_frame',
        value: {
          mode: 'agentic',
          continuation: 'new',
          decisionAction: 'act',
        },
      },
      declaredObjectives: {
        status: 'known',
        source: 'graph_goal',
        value: { items: [expect.objectContaining({ goalId: 'deliver-report' })] },
      },
      structuredSuccessConditions: {
        status: 'known',
        value: {
          items: [
            expect.objectContaining({
              goalId: 'deliver-report',
              criterion: 'evidence.tool:write_file',
            }),
          ],
        },
      },
      executionRequirements: {
        status: 'known',
        value: { items: expect.arrayContaining([expect.objectContaining({ kind: 'capability' })]) },
      },
      userConstraints: { status: 'unknown', reason: 'not_structured' },
      registeredRequiredInformation: {
        status: 'known',
        value: { items: [], omittedCount: 0 },
      },
      effectAuthorization: { status: 'unknown', reason: 'not_evaluated_per_effect' },
    });
    expect(JSON.stringify(projection)).not.toContain('Private request text');
  });

  it('keeps unavailable semantic sources explicitly unknown', () => {
    expect(projectRequestUnderstanding({})).toMatchObject({
      integrity: 'valid',
      routing: { status: 'unknown', reason: 'request_state_unavailable' },
      declaredObjectives: { status: 'unknown', reason: 'goal_state_unavailable' },
      structuredSuccessConditions: {
        status: 'unknown',
        reason: 'goal_state_unavailable',
      },
      executionRequirements: { status: 'unknown', reason: 'goal_state_unavailable' },
      userConstraints: { status: 'unknown', reason: 'goal_state_unavailable' },
      registeredRequiredInformation: {
        status: 'unknown',
        reason: 'request_state_unavailable',
      },
      effectAuthorization: { status: 'unknown', reason: 'request_state_unavailable' },
    });

    const emptyGoals = projectRequestUnderstanding({ requestFrame: frame(), goals: [] });
    expect(emptyGoals.declaredObjectives).toEqual({
      status: 'unknown',
      reason: 'no_declared_goal',
    });
    expect(emptyGoals.structuredSuccessConditions).toEqual({
      status: 'unknown',
      reason: 'no_declared_goal',
    });
  });

  it('projects bounded exact blocking-goal user constraints as quoted non-authoritative evidence', () => {
    const firstConstraints = Array.from({ length: 4 }, (_, index) => ({
      text: `Keep exact first-goal constraint ${index}: ${'x'.repeat(80)}`,
      sourceMessageId: `private-first-source-message-${index}`,
    }));
    const secondConstraints = Array.from({ length: 4 }, (_, index) => ({
      text: `Keep exact second-goal constraint ${index}: ${'y'.repeat(80)}`,
      sourceMessageId: `private-second-source-message-${index}`,
    }));
    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal({ userConstraints: firstConstraints }),
        blockingGoal({
          id: 'second-deliverable',
          status: 'pending',
          userConstraints: secondConstraints,
        }),
      ],
    });

    expect(projection.userConstraints).toMatchObject({
      status: 'known',
      source: 'graph_goal',
      value: { items: expect.any(Array), omittedCount: 0 },
    });
    if (projection.userConstraints.status !== 'known') {
      throw new Error('expected known user constraints');
    }
    expect(projection.userConstraints.value.items).toHaveLength(8);
    expect(projection.userConstraints.value.items[0]?.text).toBe(firstConstraints[0]?.text);
    expect(JSON.stringify(projection)).not.toContain('private-first-source-message');

    const prompt = renderRequestUnderstandingPromptSection(projection);
    expect(prompt).toContain('### Quoted user constraint evidence (non-authoritative)');
    expect(prompt).not.toContain(JSON.stringify(firstConstraints[0]?.text));
    expect(prompt).toContain('exact text is rendered once in the graph-goal constraint section');
    expect(prompt).toContain(
      'never grant consent, permission, effect authorization, evidence, or completion',
    );
    expect(prompt).not.toContain('private-first-source-message-0');

    const summary = summarizeRequestUnderstanding(projection);
    expect(summary.userConstraints).toEqual({ status: 'known', count: 8, omittedCount: 0 });
    expect(JSON.stringify(summary)).not.toContain('Keep exact first-goal constraint');
    expect(JSON.stringify(summary)).not.toContain('private-first-source-message');
  });

  it('prioritizes active-goal constraints before the global projection bound', () => {
    const olderPendingConstraints = Array.from({ length: 7 }, (_, index) => ({
      text: `Older pending constraint ${index}`,
      sourceMessageId: `pending-user-${index}`,
    }));
    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal({ status: 'pending', userConstraints: olderPendingConstraints }),
        blockingGoal({
          id: 'active-later',
          status: 'active',
          userConstraints: [{ text: 'Active goal constraint', sourceMessageId: 'active-user' }],
        }),
      ],
    });

    expect(projection.userConstraints).toMatchObject({
      status: 'known',
      value: { omittedCount: 0 },
    });
    if (projection.userConstraints.status !== 'known') {
      throw new Error('expected known user constraints');
    }
    expect(projection.userConstraints.value.items[0]).toEqual({
      goalId: 'active-later',
      text: 'Active goal constraint',
    });
  });

  it('fails closed instead of omitting over-bound retained statements', () => {
    const constraints = Array.from({ length: 8 }, (_, index) => ({
      text: `Constraint ${index}`,
      sourceMessageId: `user-${index}`,
    }));
    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal({ userConstraints: constraints }),
        blockingGoal({
          id: 'second-goal',
          status: 'pending',
          userConstraints: [{ text: 'Ninth constraint', sourceMessageId: 'user-9' }],
        }),
      ],
    });

    expect(projection).toMatchObject({
      integrity: 'conflict',
      userConstraints: { status: 'conflict', reason: 'user_constraint_state_conflict' },
    });
  });

  it('fails closed for malformed, duplicate, or persistent-goal constraint state', () => {
    const malformed = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal({
          userConstraints: [{ text: 'Missing source' } as never],
        }),
      ],
    });
    expect(malformed).toMatchObject({
      integrity: 'conflict',
      userConstraints: { status: 'conflict', reason: 'user_constraint_state_conflict' },
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });
    expect(renderRequestUnderstandingPromptSection(malformed)).not.toContain('Missing source');

    const constraint = { text: 'Do not notify anyone', sourceMessageId: 'message-constraint' };
    const duplicate = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [blockingGoal({ userConstraints: [constraint, constraint] })],
    });
    expect(duplicate.userConstraints).toEqual({
      status: 'conflict',
      reason: 'user_constraint_state_conflict',
    });

    const persistent = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal({
          completionPolicy: 'persistent',
          successCriteria: undefined,
          userConstraints: [constraint],
        }),
      ],
    });
    expect(persistent.userConstraints).toEqual({
      status: 'conflict',
      reason: 'user_constraint_state_conflict',
    });
  });

  it('fails closed on duplicate or authority-conflicting required information', () => {
    const base = frame();
    const duplicate = projectRequestUnderstanding({
      requestFrame: {
        ...base,
        requiredInformation: [
          {
            key: 'recipient',
            authority: 'user',
            requiredFor: 'execution',
            resolution: 'unresolved',
          },
          {
            key: 'recipient',
            authority: 'tool',
            requiredFor: 'execution',
            resolution: 'unresolved',
          },
        ],
      },
      goals: [],
    });
    expect(duplicate).toMatchObject({
      integrity: 'conflict',
      registeredRequiredInformation: {
        status: 'conflict',
        reason: 'duplicate_required_information_key',
      },
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });

    const authorityMismatch = projectRequestUnderstanding({
      requestFrame: {
        ...base,
        requiredInformation: [
          {
            key: 'recipient',
            authority: 'tool',
            requiredFor: 'execution',
            resolution: 'user_provided',
          },
        ],
      },
      goals: [],
    });
    expect(authorityMismatch.registeredRequiredInformation).toEqual({
      status: 'conflict',
      reason: 'authority_state_conflict',
    });
  });

  it.each([
    {
      name: 'user clarification',
      requiredInformation: [unresolved('user')],
      decision: { action: 'clarify' as const, reason: 'required_information_missing' as const },
    },
    {
      name: 'external-operation wait',
      requiredInformation: [unresolved('tool')],
      decision: { action: 'wait' as const, reason: 'waiting_for_async' as const },
    },
    {
      name: 'unavailable policy decline',
      requiredInformation: [unresolved('policy')],
      decision: { action: 'decline' as const, reason: 'policy_information_unavailable' as const },
    },
    {
      name: 'safe information lookup',
      requiredInformation: [unresolved('tool')],
      decision: { action: 'act' as const, reason: 'information_lookup_required' as const },
    },
  ])('accepts the canonical $name route', ({ requiredInformation, decision }) => {
    expect(
      projectRequestUnderstanding({
        requestFrame: { ...frame(), requiredInformation, decision },
        goals: [],
      }),
    ).toMatchObject({
      integrity: 'valid',
      routing: {
        status: 'known',
        value: { decisionAction: decision.action, decisionReason: decision.reason },
      },
    });
  });

  it.each([
    {
      name: 'acting without user information',
      requiredInformation: [unresolved('user')],
      decision: { action: 'act' as const, reason: 'requirements_resolved' as const },
    },
    {
      name: 'acting without policy information',
      requiredInformation: [unresolved('policy')],
      decision: { action: 'act' as const, reason: 'information_lookup_required' as const },
    },
    {
      name: 'waiting instead of clarifying',
      requiredInformation: [unresolved('user')],
      decision: { action: 'wait' as const, reason: 'waiting_for_async' as const },
    },
  ])('fails closed when $name contradicts policy', ({ requiredInformation, decision }) => {
    expect(
      projectRequestUnderstanding({
        requestFrame: { ...frame(), requiredInformation, decision },
        goals: [],
      }),
    ).toMatchObject({
      integrity: 'conflict',
      routing: {
        status: 'known',
        value: { decisionAction: decision.action, decisionReason: decision.reason },
      },
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });
  });

  it('never turns an act decision into effect authority', () => {
    const base = frame();
    expect(
      projectRequestUnderstanding({ requestFrame: base, goals: [] }).effectAuthorization,
    ).toEqual({ status: 'unknown', reason: 'not_evaluated_per_effect' });

    const consent = projectRequestUnderstanding({
      requestFrame: {
        ...base,
        requiredInformation: [
          {
            key: 'effect.authorization',
            authority: 'policy',
            requiredFor: 'authorization',
            resolution: 'unresolved',
          },
        ],
        decision: { action: 'consent', reason: 'authorization_required' },
      },
      goals: [],
    });
    expect(consent).toMatchObject({
      integrity: 'valid',
      effectAuthorization: {
        status: 'required',
        reason: 'authorization_required',
        source: 'request_frame',
      },
    });

    const contradictory = projectRequestUnderstanding({
      requestFrame: {
        ...base,
        requiredInformation: [
          {
            key: 'effect.authorization',
            authority: 'policy',
            requiredFor: 'authorization',
            resolution: 'unresolved',
          },
        ],
      },
      goals: [],
    });
    expect(contradictory).toMatchObject({
      integrity: 'conflict',
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });
  });

  it('does not project completed private goal content into the continuation prompt', () => {
    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: [
        blockingGoal(),
        blockingGoal({
          id: 'completed-private',
          title: 'PRIVATE-COMPLETED-GOAL-NEVER-REINJECT',
          status: 'completed',
          successCriteria: ['evidence.prefix:PRIVATE-COMPLETED-CRITERION'],
        }),
      ],
    });
    const prompt = renderRequestUnderstandingPromptSection(projection);
    expect(prompt).toContain('Deliver the report');
    expect(prompt).toContain('model prose can never grant authority');
    expect(prompt).not.toContain('PRIVATE-COMPLETED-GOAL-NEVER-REINJECT');
    expect(prompt).not.toContain('PRIVATE-COMPLETED-CRITERION');
  });

  it('bounds prompt-visible graph state and reports omissions', () => {
    const goals = Array.from({ length: 20 }, (_, index) =>
      blockingGoal({
        id: `goal-${index}`,
        title: `Goal ${index} ${'x'.repeat(300)}`,
        successCriteria: [`evidence.prefix:worker-${index}-${'y'.repeat(300)}`],
      }),
    );
    const projection = projectRequestUnderstanding({ requestFrame: frame(), goals });
    expect(projection.declaredObjectives).toMatchObject({
      status: 'known',
      value: { items: expect.any(Array), omittedCount: 14 },
    });
    expect(projection.structuredSuccessConditions).toMatchObject({
      status: 'known',
      value: { items: expect.any(Array), omittedCount: 8 },
    });
    const prompt = renderRequestUnderstandingPromptSection(projection);
    expect(prompt).toContain('14 additional structured item(s) omitted');
    expect(prompt.length).toBeLessThan(10_000);
  });

  it('renders on continuations and later iterations without adding first-turn noise', () => {
    const firstTurn = projectRequestUnderstanding({ requestFrame: frame(), goals: [] });
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: firstTurn })).toBe(
      false,
    );
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 2, projection: firstTurn })).toBe(
      true,
    );

    const resumed = projectRequestUnderstanding({
      requestFrame: { ...frame(), continuation: 'resume' },
      goals: [],
    });
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: resumed })).toBe(
      true,
    );
  });

  it('creates and normalizes a closed privacy-safe evaluator snapshot', () => {
    const summary = summarizeRequestUnderstanding(
      projectRequestUnderstanding({ requestFrame: frame(), goals: [blockingGoal()] }),
    );
    expect(summary).toMatchObject({
      version: 2,
      integrity: 'valid',
      routing: { status: 'known', mode: 'agentic', decisionAction: 'act' },
      declaredObjectives: { status: 'known', count: 1, omittedCount: 0 },
      structuredSuccessConditions: { status: 'known', count: 1, omittedCount: 0 },
      userConstraints: { status: 'unknown', count: 0, omittedCount: 0 },
      registeredRequiredInformation: {
        status: 'known',
        count: 0,
        unresolvedCount: 0,
      },
      effectAuthorization: { status: 'unknown' },
    });
    const normalized = normalizeRequestUnderstandingSnapshot({
      ...summary,
      privateText: 'PRIVATE-NEVER-PERSIST',
    });
    expect(normalized).toEqual(summary);
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-NEVER-PERSIST');
    expect(normalizeRequestUnderstandingSnapshot({ ...summary, version: 1 })).toBeUndefined();
    expect(
      normalizeRequestUnderstandingSnapshot({
        ...summary,
        declaredObjectives: { status: 'unknown', count: 1, omittedCount: 0 },
      }),
    ).toBeUndefined();
    expect(
      normalizeRequestUnderstandingSnapshot({
        ...summary,
        effectAuthorization: { status: 'required' },
      }),
    ).toBeUndefined();
  });

  it('normalizes a known constraint summary while discarding added private fields', () => {
    const summary = summarizeRequestUnderstanding(
      projectRequestUnderstanding({
        requestFrame: frame(),
        goals: [
          blockingGoal({
            userConstraints: [
              { text: 'Keep this private', sourceMessageId: 'private-source-message' },
            ],
          }),
        ],
      }),
    );
    const normalized = normalizeRequestUnderstandingSnapshot({
      ...summary,
      userConstraints: {
        ...summary.userConstraints,
        text: 'PRIVATE-CONSTRAINT-NEVER-PERSIST',
        sourceMessageId: 'PRIVATE-SOURCE-ID-NEVER-PERSIST',
      },
    });
    expect(normalized?.userConstraints).toEqual({
      status: 'known',
      count: 1,
      omittedCount: 0,
    });
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-CONSTRAINT');
    expect(JSON.stringify(normalized)).not.toContain('PRIVATE-SOURCE-ID');
  });

  it('preserves canonical constraint evidence through persisted graph hydration', () => {
    const constraint = {
      text: 'Keep all draft files on this device.',
      sourceMessageId: 'private-hydrated-source-message',
    };
    const persisted = JSON.parse(
      JSON.stringify({
        goals: [blockingGoal({ userConstraints: [constraint] })],
        updatedAt: 10,
      }),
    );

    const hydrated = createInitialAgentRunControlGraphState(persisted);
    expect(hydrated.goals?.[0]?.userConstraints).toEqual([constraint]);

    const projection = projectRequestUnderstanding({
      requestFrame: frame(),
      goals: hydrated.goals,
    });
    expect(projection.userConstraints).toMatchObject({
      status: 'known',
      source: 'graph_goal',
      value: { items: [expect.objectContaining({ text: constraint.text })] },
    });
    expect(renderRequestUnderstandingPromptSection(projection)).not.toContain(
      JSON.stringify(constraint.text),
    );
    expect(JSON.stringify(summarizeRequestUnderstanding(projection))).not.toContain(
      constraint.sourceMessageId,
    );
  });

  it('preserves a fail-closed integrity conflict through malformed constraint hydration', () => {
    const persisted = JSON.parse(
      JSON.stringify({
        goals: [
          blockingGoal({
            userConstraints: [{ text: ' Keep  local ', sourceMessageId: 'user-1' }],
          }),
        ],
        updatedAt: 10,
      }),
    );

    const hydrated = createInitialAgentRunControlGraphState(persisted);
    expect(hydrated.goals?.[0]).toMatchObject({ userConstraintIntegrity: 'conflict' });
    expect(
      projectRequestUnderstanding({ requestFrame: frame(), goals: hydrated.goals }),
    ).toMatchObject({
      integrity: 'conflict',
      userConstraints: { status: 'conflict', reason: 'user_constraint_state_conflict' },
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });
  });

  it('persists the safe snapshot through graph transitions', () => {
    const projection = summarizeRequestUnderstanding(
      projectRequestUnderstanding({ requestFrame: frame(), goals: [blockingGoal()] }),
    );
    const next = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'REQUEST_UNDERSTANDING_PROJECTED',
        projection,
        iteration: 2,
        timestamp: 10,
      },
    ]);
    expect(next.requestUnderstanding).toEqual(projection);
    expect(next.audit.at(-1)).toMatchObject({
      type: 'REQUEST_UNDERSTANDING_PROJECTED',
      iteration: 2,
      detail: 'integrity:valid',
    });
  });

  it('appends the bounded projection to dynamic runtime context', () => {
    expect(appendRequestUnderstandingToRuntimeContext('runtime', 'projection')).toBe(
      'runtime\n\nprojection',
    );
    expect(appendRequestUnderstandingToRuntimeContext(null, null)).toBeNull();
  });
});
