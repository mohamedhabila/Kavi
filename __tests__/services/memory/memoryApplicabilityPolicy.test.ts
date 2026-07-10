import { makeMemoryFact as makeMemoryFactFixture } from '../../helpers/memoryFactFixtures';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import {
  applyMemoryApplicabilityPolicy,
  MEMORY_APPLICABILITY_MIN_CONFIDENCE,
} from '../../../src/services/memory/memoryApplicabilityPolicy';
import {
  MEMORY_APPLICABILITY_REASONS,
  type MemoryApplicabilityContext,
  type MemoryExternalEvidenceSignal,
} from '../../../src/services/memory/memoryApplicabilityTypes';
import type { RequiredMemoryAccessScopeIdentity } from '../../../src/services/memory/memoryScopeIdentity';

const NOW = 10_000;

function policyScope(
  overrides: Partial<RequiredMemoryAccessScopeIdentity> = {},
): RequiredMemoryAccessScopeIdentity {
  return {
    memoryOwnerId: 'vault-owner',
    memoryConversationId: 'memory-conversation',
    sourceThreadId: 'source-thread',
    taskId: 'task-1',
    personaId: 'persona-1',
    ...overrides,
  };
}

function makeMemoryFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return makeMemoryFactFixture({
    factClass: 'subjective_user',
    sourceAuthority: 'grounded_user',
    scope: 'global',
    originConversationId: null,
    originThreadId: null,
    originTaskId: null,
    ...overrides,
  });
}

function context(overrides: Partial<MemoryApplicabilityContext> = {}): MemoryApplicabilityContext {
  return {
    enabled: true,
    now: NOW,
    useIntent: 'automatic_prompt',
    scope: policyScope(),
    conflictObservationReadState: 'available',
    ...overrides,
  };
}

function decideFact(
  fact = makeMemoryFact(),
  contextOverride: Partial<MemoryApplicabilityContext> = {},
) {
  return applyMemoryApplicabilityPolicy({
    facts: [fact],
    context: context(contextOverride),
  }).factDecisions[0];
}

describe('memory applicability policy', () => {
  it('uses a current, in-scope, normal, sufficiently confident fact', () => {
    expect(decideFact()).toMatchObject({
      action: 'use',
      reason: 'eligible',
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
    });
  });

  it.each([
    ['deleted', { deletedAt: 9_000 }, 'deleted'],
    ['not-yet-valid', { validAt: 11_000 }, 'not_yet_valid'],
    ['future-created', { createdAt: 11_000 }, 'not_yet_valid'],
    ['invalidated', { invalidAt: 9_000 }, 'invalidated'],
    ['expired', { expiresAt: 10_000 }, 'expired'],
  ] as const)('silences the hard %s gate', (_label, overrides, reason) => {
    expect(decideFact(makeMemoryFact(overrides))).toMatchObject({ action: 'silent', reason });
  });

  it.each([
    ['negative valid time', { validAt: -1 }],
    ['fractional created time', { createdAt: 1.5 }],
    ['unsafe invalid time', { invalidAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite expiry', { expiresAt: Number.NaN }],
  ] as const)('fails closed on a %s', (_label, overrides) => {
    expect(decideFact(makeMemoryFact(overrides))).toMatchObject({
      action: 'silent',
      reason: 'not_yet_valid',
    });
  });

  it.each([
    ['global persona', { scope: 'global', personaId: 'persona-1' }],
    ['global conversation', { scope: 'global', originConversationId: 'memory-conversation' }],
    ['global thread', { scope: 'global', originThreadId: 'source-thread' }],
    ['global task', { scope: 'global', originTaskId: 'task-1' }],
    [
      'persona conversation',
      { scope: 'persona', personaId: 'persona-1', originConversationId: 'memory-conversation' },
    ],
    [
      'persona thread',
      { scope: 'persona', personaId: 'persona-1', originThreadId: 'source-thread' },
    ],
    ['persona task', { scope: 'persona', personaId: 'persona-1', originTaskId: 'task-1' }],
    [
      'conversation persona',
      {
        scope: 'conversation',
        personaId: 'persona-1',
        originConversationId: 'memory-conversation',
      },
    ],
    [
      'conversation task',
      {
        scope: 'conversation',
        originConversationId: 'memory-conversation',
        originTaskId: 'task-1',
      },
    ],
    [
      'project persona',
      {
        scope: 'project',
        personaId: 'persona-1',
        originConversationId: 'memory-conversation',
      },
    ],
    [
      'project task',
      {
        scope: 'project',
        originConversationId: 'memory-conversation',
        originTaskId: 'task-1',
      },
    ],
    [
      'session missing task',
      {
        scope: 'session',
        originConversationId: 'memory-conversation',
        originThreadId: 'source-thread',
        originTaskId: null,
      },
    ],
  ] as const)('fails closed on malformed %s binding', (_label, overrides) => {
    expect(decideFact(makeMemoryFact(overrides as Partial<MemoryFact>))).toMatchObject({
      action: 'silent',
    });
  });

  it('fails closed on an invalid runtime scope value', () => {
    const fact = makeMemoryFact() as MemoryFact & { scope: string };
    fact.scope = 'legacy';
    expect(decideFact(fact as MemoryFact)).toMatchObject({
      action: 'silent',
      reason: 'unknown_scope',
    });
  });

  it('fails scoped facts closed without exact scope identity', () => {
    const conversationFact = makeMemoryFact({
      scope: 'conversation',
      originConversationId: 'memory-conversation',
    });
    expect(decideFact(conversationFact)).toMatchObject({ action: 'use' });
    expect(
      decideFact(conversationFact, {
        scope: policyScope({ memoryConversationId: 'other' }),
      }),
    ).toMatchObject({ action: 'silent', reason: 'scope_mismatch' });
    expect(decideFact(conversationFact, { scope: null })).toMatchObject({
      action: 'silent',
      reason: 'scope_context_missing',
    });

    const sessionFact = makeMemoryFact({
      scope: 'session',
      originConversationId: 'memory-conversation',
      originThreadId: 'source-thread',
      originTaskId: 'task-1',
    });
    expect(decideFact(sessionFact)).toMatchObject({ action: 'use' });
    expect(
      decideFact(sessionFact, {
        scope: {
          ...policyScope(),
          taskId: 'task-2',
        },
      }),
    ).toMatchObject({ action: 'silent', reason: 'scope_mismatch' });
  });

  it('requires a persisted exact persona binding', () => {
    const fact = makeMemoryFact({ id: 'persona-fact', scope: 'persona' });
    expect(decideFact(fact)).toMatchObject({
      action: 'silent',
      reason: 'persona_binding_missing',
    });

    const matching = makeMemoryFact({
      id: 'persona-fact',
      scope: 'persona',
      factClass: 'subjective_user',
      personaId: 'persona-1',
    });
    expect(decideFact(matching)).toMatchObject({ action: 'use' });
    expect(
      decideFact(matching, {
        scope: policyScope({ personaId: 'persona-2' }),
      }),
    ).toMatchObject({ action: 'silent', reason: 'persona_mismatch' });

    const providerAuthored = makeMemoryFact({
      id: 'provider-persona-fact',
      scope: 'persona',
      attributes: {
        applicabilityV1: {
          factClass: 'subjective_user',
          sourceAuthority: 'grounded_user',
          personaId: 'persona-1',
        },
      },
    });
    expect(decideFact(providerAuthored)).toMatchObject({
      action: 'silent',
      reason: 'persona_binding_missing',
    });
  });

  it.each([
    ['pending_review', 'normal', 'ask', 'pending_review'],
    ['stale', 'normal', 'ask', 'stale_memory'],
    ['rejected', 'normal', 'silent', 'rejected_review'],
    ['provider_selected', 'normal', 'silent', 'unknown_review_state'],
    ['auto', 'restricted', 'silent', 'restricted_sensitivity'],
    ['auto', 'provider_clearance', 'silent', 'unknown_sensitivity'],
  ] as const)(
    'maps review=%s and sensitivity=%s to %s',
    (reviewState, sensitivity, action, reason) => {
      expect(decideFact(makeMemoryFact({ reviewState, sensitivity }))).toMatchObject({
        action,
        reason,
      });
    },
  );

  it('never proactively injects sensitive memory and requires explicit confirmation when weak', () => {
    const sensitive = makeMemoryFact({
      factClass: 'workflow',
      sourceAuthority: 'tool_observed',
      sensitivity: 'sensitive',
    });
    expect(decideFact(sensitive)).toMatchObject({
      action: 'silent',
      reason: 'sensitive_proactive_suppressed',
    });
    expect(
      decideFact(sensitive, {
        useIntent: 'explicit_user_request',
      }),
    ).toMatchObject({ action: 'ask', reason: 'sensitive_confirmation_required' });
    expect(
      decideFact(makeMemoryFact({ sensitivity: 'sensitive', reviewState: 'verified' }), {
        useIntent: 'explicit_user_request',
      }),
    ).toMatchObject({ action: 'use', reason: 'eligible' });

    const grounded = makeMemoryFact({
      sensitivity: 'sensitive',
      sourceAuthority: 'grounded_user',
    });
    expect(
      decideFact(grounded, {
        useIntent: 'explicit_user_request',
      }),
    ).toMatchObject({ action: 'use', sourceAuthority: 'grounded_user' });
  });

  it('asks rather than asserts low-confidence memory', () => {
    expect(
      decideFact(makeMemoryFact({ confidence: MEMORY_APPLICABILITY_MIN_CONFIDENCE - 0.01 })),
    ).toMatchObject({ action: 'ask', reason: 'low_confidence' });
  });

  it('enforces class-specific source authority before direct use', () => {
    const subjectiveInference = makeMemoryFact({ sourceAuthority: 'assistant_inferred' });
    expect(decideFact(subjectiveInference)).toMatchObject({
      action: 'silent',
      reason: 'subjective_authority_confirmation_required',
    });
    expect(decideFact(subjectiveInference, { useIntent: 'explicit_user_request' })).toMatchObject({
      action: 'ask',
      reason: 'subjective_authority_confirmation_required',
    });
    expect(decideFact(makeMemoryFact({ sourceAuthority: 'grounded_user' }))).toMatchObject({
      action: 'use',
    });

    for (const sourceAuthority of ['grounded_user', 'tool_observed', 'external_source'] as const) {
      expect(decideFact(makeMemoryFact({ factClass: 'objective', sourceAuthority }))).toMatchObject(
        { action: 'use', reason: 'eligible' },
      );
    }
    expect(
      decideFact(
        makeMemoryFact({
          factClass: 'objective',
          sourceAuthority: 'assistant_inferred',
          reviewState: 'verified',
        }),
      ),
    ).toMatchObject({ action: 'abstain', reason: 'objective_authority_insufficient' });

    const inferredWorkflow = makeMemoryFact({
      factClass: 'workflow',
      sourceAuthority: 'assistant_inferred',
    });
    expect(decideFact(inferredWorkflow)).toMatchObject({
      action: 'silent',
      reason: 'workflow_authority_confirmation_required',
    });
    expect(decideFact(inferredWorkflow, { useIntent: 'explicit_user_request' })).toMatchObject({
      action: 'ask',
      reason: 'workflow_authority_confirmation_required',
    });
    expect(decideFact({ ...inferredWorkflow, reviewState: 'verified' })).toMatchObject({
      action: 'use',
      reason: 'eligible',
    });
    expect(
      decideFact(makeMemoryFact({ factClass: 'workflow', sourceAuthority: 'tool_observed' })),
    ).toMatchObject({ action: 'use', reason: 'eligible' });
  });

  it('detects conflicting active values without reading their language or keywords', () => {
    const scripts = [
      ['fact-ar', 'اللون', 'أزرق'],
      ['fact-ja', '色', '青'],
      ['fact-es', 'color', 'azul'],
    ];
    for (const [id, predicate, firstValue] of scripts) {
      const result = applyMemoryApplicabilityPolicy({
        facts: [
          makeMemoryFact({ id: `${id}-1`, predicate, objectText: firstValue }),
          makeMemoryFact({ id: `${id}-2`, predicate, objectText: `${firstValue}-2` }),
        ],
        context: context(),
      });
      expect(result.factDecisions.map((decision) => [decision.action, decision.reason])).toEqual([
        ['ask', 'conflicting_current_memories'],
        ['ask', 'conflicting_current_memories'],
      ]);
    }
  });

  it('does not let hidden restricted or rejected facts influence an eligible fact', () => {
    const visible = makeMemoryFact({ id: 'visible', objectText: 'visible-value' });
    const result = applyMemoryApplicabilityPolicy({
      facts: [
        visible,
        makeMemoryFact({
          id: 'restricted-hidden',
          objectText: 'restricted-value',
          sensitivity: 'restricted',
        }),
        makeMemoryFact({
          id: 'rejected-hidden',
          objectText: 'rejected-value',
          reviewState: 'rejected',
        }),
      ],
      context: context(),
    });

    expect(result.factDecisions).toEqual([
      expect.objectContaining({ factId: 'visible', action: 'use', reason: 'eligible' }),
      expect.objectContaining({
        factId: 'restricted-hidden',
        action: 'silent',
        reason: 'restricted_sensitivity',
      }),
      expect.objectContaining({
        factId: 'rejected-hidden',
        action: 'silent',
        reason: 'rejected_review',
      }),
    ]);
  });

  it('abstains on objective current or stored conflicts', () => {
    const facts = [
      makeMemoryFact({ id: 'objective-1', objectText: 'v1' }),
      makeMemoryFact({ id: 'objective-2', objectText: 'v2' }),
    ];
    const objectiveFacts = facts.map((fact) => ({
      ...fact,
      factClass: 'objective',
      sourceAuthority: 'external_source',
    }));
    const currentConflict = applyMemoryApplicabilityPolicy({
      facts: objectiveFacts,
      context: context(),
    });
    expect(currentConflict.factDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'abstain', reason: 'objective_current_conflict' }),
      ]),
    );

    const stored = makeMemoryFact({
      id: 'objective-1',
      factClass: 'objective',
      sourceAuthority: 'external_source',
      reviewState: 'conflicted',
    });
    expect(decideFact(stored)).toMatchObject({
      action: 'abstain',
      reason: 'objective_stored_conflict',
    });
    expect(decideFact(makeMemoryFact({ lastConflictedAt: 9_000 }))).toMatchObject({
      action: 'use',
      reason: 'eligible',
    });
  });

  it('uses only caller-owned structural external conflicts for objective abstention', () => {
    const fact = makeMemoryFact({ id: 'external-conflict-fact' });
    const external: MemoryExternalEvidenceSignal = {
      factId: fact.id,
      relation: 'conflicts',
      factClass: 'objective',
      sourceAuthority: 'external_source',
      sourceKind: 'external_record',
      sourceId: 'external-record-1',
      observedAt: 9_000,
    };
    expect(decideFact(fact, { externalEvidence: [external] })).toMatchObject({
      action: 'abstain',
      reason: 'objective_external_conflict',
    });
    expect(
      decideFact(fact, {
        externalEvidence: [{ ...external, factClass: 'subjective_user' }],
      }),
    ).toMatchObject({ action: 'ask', reason: 'external_conflict_needs_clarification' });
    expect(
      decideFact(fact, { externalEvidence: [{ ...external, observedAt: NOW + 1 }] }),
    ).toMatchObject({ action: 'abstain', reason: 'invalid_external_evidence' });
  });

  it('does not trust generic attributes to self-declare objective authority', () => {
    const fact = makeMemoryFact({
      factClass: 'unknown',
      sourceAuthority: 'unknown',
      attributes: {
        applicabilityV1: {
          factClass: 'objective',
          sourceAuthority: 'external_source',
          sensitivity: 'normal',
        },
      },
    });
    expect(decideFact(fact)).toMatchObject({
      action: 'silent',
      reason: 'unknown_fact_class',
      factClass: 'unknown',
      sourceAuthority: 'unknown',
    });

    expect(
      decideFact(makeMemoryFact({ factClass: 'objective', sourceAuthority: 'assistant_inferred' })),
    ).toMatchObject({
      action: 'abstain',
      reason: 'objective_authority_insufficient',
    });
  });

  it('preserves exact owner, root, thread, and task identifiers without trimming', () => {
    expect(decideFact(makeMemoryFact({ memoryOwnerId: 'vault-owner ' }))).toMatchObject({
      action: 'silent',
      reason: 'owner_binding_missing',
    });
    expect(
      decideFact(
        makeMemoryFact({
          scope: 'conversation',
          originConversationId: 'memory-conversation ',
        }),
      ),
    ).toMatchObject({ action: 'silent', reason: 'scope_context_missing' });
    expect(
      decideFact(
        makeMemoryFact({
          scope: 'session',
          originConversationId: 'memory-conversation',
          originThreadId: 'source-thread ',
          originTaskId: 'task-1',
        }),
      ),
    ).toMatchObject({ action: 'silent', reason: 'scope_context_missing' });
    expect(
      decideFact(
        makeMemoryFact({
          scope: 'session',
          originConversationId: 'memory-conversation',
          originThreadId: 'source-thread',
          originTaskId: 'task-1 ',
        }),
      ),
    ).toMatchObject({ action: 'silent', reason: 'scope_context_missing' });
  });

  it('abstains when persisted contradiction observations cannot be read', () => {
    expect(decideFact(makeMemoryFact(), { conflictObservationReadState: 'failed' })).toMatchObject({
      action: 'abstain',
      reason: 'conflict_observation_read_failed',
    });
  });

  it('keeps the content-free summary canonical and memory-off decisions silent', () => {
    const fact = makeMemoryFact({
      id: 'private-fact-id',
      objectText: 'معلومة خاصة',
      predicate: '秘密',
    });
    const result = applyMemoryApplicabilityPolicy({
      facts: [fact],
      context: context({ enabled: false }),
    });

    expect(result.factDecisions[0]).toMatchObject({
      action: 'silent',
      reason: 'memory_disabled',
    });
    expect(result.summary).toMatchObject({
      state: 'disabled',
      candidateFactCount: 1,
      factActions: { use: 0, ask: 0, abstain: 0, silent: 1 },
    });
    expect(result.summary.reasonCounts.map((entry) => entry.reason)).toEqual(
      MEMORY_APPLICABILITY_REASONS,
    );
    const serialized = JSON.stringify(result.summary);
    expect(serialized).not.toContain('private-fact-id');
    expect(serialized).not.toContain('معلومة خاصة');
    expect(serialized).not.toContain('秘密');
  });
});
