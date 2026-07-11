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
      version: 1,
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
      userConstraints: { status: 'unknown', reason: 'not_structured' },
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
    expect(
      shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: firstTurn }),
    ).toBe(false);
    expect(
      shouldRenderRequestUnderstandingPrompt({ iteration: 2, projection: firstTurn }),
    ).toBe(true);

    const resumed = projectRequestUnderstanding({
      requestFrame: { ...frame(), continuation: 'resume' },
      goals: [],
    });
    expect(
      shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: resumed }),
    ).toBe(true);
  });

  it('creates and normalizes a closed privacy-safe evaluator snapshot', () => {
    const summary = summarizeRequestUnderstanding(
      projectRequestUnderstanding({ requestFrame: frame(), goals: [blockingGoal()] }),
    );
    expect(summary).toMatchObject({
      version: 1,
      integrity: 'valid',
      routing: { status: 'known', mode: 'agentic', decisionAction: 'act' },
      declaredObjectives: { status: 'known', count: 1, omittedCount: 0 },
      structuredSuccessConditions: { status: 'known', count: 1, omittedCount: 0 },
      userConstraints: { status: 'unknown' },
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
    expect(normalizeRequestUnderstandingSnapshot({ ...summary, version: 2 })).toBeUndefined();
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
