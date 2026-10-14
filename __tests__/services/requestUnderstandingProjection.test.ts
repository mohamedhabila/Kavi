import {
  normalizeRequestUnderstandingSnapshot,
  projectRequestUnderstanding,
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
      version: 4,
      integrity: 'valid',
      routing: {
        status: 'known',
        source: 'request_frame',
        value: {
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
      version: 4,
      integrity: 'valid',
      routing: { status: 'unknown', reason: 'request_state_unavailable' },
      registeredRequiredInformation: { status: 'unknown', reason: 'request_state_unavailable' },
      effectAuthorization: { status: 'unknown', reason: 'request_state_unavailable' },
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
      name: 'acting without user information despite a lookup',
      requiredInformation: [unresolved('user'), unresolved('tool')],
      decision: { action: 'act' as const, reason: 'information_lookup_required' as const },
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

  it('never turns a decision into effect authority', () => {
    expect(projectRequestUnderstanding({ requestFrame: frame() }).effectAuthorization).toEqual({
      status: 'unknown',
      reason: 'not_evaluated_per_effect',
    });
  });

  it('creates and normalizes a closed privacy-safe evaluator snapshot', () => {
    const summary = summarizeRequestUnderstanding(
      projectRequestUnderstanding({ requestFrame: frame() }),
    );
    expect(summary).toEqual({
      version: 4,
      integrity: 'valid',
      routing: {
        status: 'known',
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
});
