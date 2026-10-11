import {
  appendRequestUnderstandingToRuntimeContext,
  normalizeRequestUnderstandingSnapshot,
  projectRequestUnderstanding,
  renderRequestUnderstandingPromptSection,
  shouldRenderRequestUnderstandingPrompt,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import type {
  RequestFrame,
  RequiredRequestInformation,
} from '../../src/services/agents/requestFrame';
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

describe('request understanding projection', () => {
  it('projects only structured request state', () => {
    const projection = projectRequestUnderstanding({ requestFrame: frame() });

    expect(projection).toEqual({
      version: 3,
      integrity: 'valid',
      routing: {
        status: 'known',
        source: 'request_frame',
        value: {
          mode: 'agentic',
          inputKind: 'text',
          attachmentCount: 0,
          continuation: 'new',
          decisionAction: 'act',
          decisionReason: 'actionable_input',
        },
      },
      registeredRequiredInformation: {
        status: 'known',
        source: 'request_frame',
        value: { items: [], omittedCount: 0 },
      },
      effectAuthorization: { status: 'unknown', reason: 'not_evaluated_per_effect' },
    });
    expect(JSON.stringify(projection)).not.toContain('Private request text');
  });

  it('keeps unavailable request state explicitly unknown', () => {
    expect(projectRequestUnderstanding({})).toEqual({
      version: 3,
      integrity: 'valid',
      routing: { status: 'unknown', reason: 'request_state_unavailable' },
      registeredRequiredInformation: { status: 'unknown', reason: 'request_state_unavailable' },
      effectAuthorization: { status: 'unknown', reason: 'request_state_unavailable' },
    });
  });

  it('renders no goal or bookkeeping text into the prompt', () => {
    const prompt = renderRequestUnderstandingPromptSection(
      projectRequestUnderstanding({ requestFrame: frame() }),
    );

    expect(prompt).toContain('### Code-owned route');
    expect(prompt).toContain('model prose can never grant authority');
    expect(prompt).not.toMatch(/goal|objective|success condition|constraint/i);
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
    expect(projectRequestUnderstanding({ requestFrame: base }).effectAuthorization).toEqual({
      status: 'unknown',
      reason: 'not_evaluated_per_effect',
    });

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
    });
    expect(contradictory).toMatchObject({
      integrity: 'conflict',
      effectAuthorization: { status: 'unknown', reason: 'state_conflict' },
    });
  });

  it('renders on continuations and later iterations without adding first-turn noise', () => {
    const firstTurn = projectRequestUnderstanding({ requestFrame: frame() });
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: firstTurn })).toBe(
      false,
    );
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 2, projection: firstTurn })).toBe(
      true,
    );

    const resumed = projectRequestUnderstanding({
      requestFrame: { ...frame(), continuation: 'resume' },
    });
    expect(shouldRenderRequestUnderstandingPrompt({ iteration: 1, projection: resumed })).toBe(
      true,
    );
  });

  it('creates and normalizes a closed privacy-safe evaluator snapshot', () => {
    const summary = summarizeRequestUnderstanding(
      projectRequestUnderstanding({ requestFrame: frame() }),
    );
    expect(summary).toEqual({
      version: 3,
      integrity: 'valid',
      routing: {
        status: 'known',
        mode: 'agentic',
        inputKind: 'text',
        attachmentCount: 0,
        continuation: 'new',
        decisionAction: 'act',
        decisionReason: 'actionable_input',
      },
      registeredRequiredInformation: {
        status: 'known',
        count: 0,
        omittedCount: 0,
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
    // A snapshot from before goals left the projection is dropped, not reinterpreted.
    expect(normalizeRequestUnderstandingSnapshot({ ...summary, version: 2 })).toBeUndefined();
    expect(
      normalizeRequestUnderstandingSnapshot({
        ...summary,
        registeredRequiredInformation: {
          status: 'unknown',
          count: 1,
          omittedCount: 0,
          unresolvedCount: 0,
        },
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
      projectRequestUnderstanding({ requestFrame: frame() }),
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
