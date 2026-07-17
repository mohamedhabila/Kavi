import {
  mergeFactContributionProjection,
  overlayFactContributionExplicitProjectionForRetirement,
  projectFactFromSurvivingContributions,
  type FactContributionExplicitProjection,
  type VerifiedFactContributionProjectionInput,
} from '../../../src/services/memory/facts/factContributionProjection';
import {
  MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
  type MemoryFactContributionPayloadV2,
  type NormalizedRecordFactContributionInputV2,
} from '../../../src/services/memory/factContributionCodec';
import { MEMORY_FACT_SENSITIVITY_POLICY_VERSION } from '../../../src/services/memory/memorySensitivityPolicy';

const FACT_ID = 'fact_projection_target';
const CLASSIFIER_CONTEXT = { subject: '主体' } as const;

function contributionId(hexDigit: string): string {
  return `mfc_${hexDigit.repeat(64)}`;
}

function contribution(
  hexDigit: string,
  contributedAt: number,
  overrides: Partial<NormalizedRecordFactContributionInputV2> = {},
  applicability: Partial<MemoryFactContributionPayloadV2['applicability']> = {},
): VerifiedFactContributionProjectionInput {
  const input: NormalizedRecordFactContributionInputV2 = {
    subjectId: 'entity_projection_subject',
    predicate: '共通_مشترك',
    objectText: '青_أزرق',
    objectEntityId: null,
    attributes: {},
    confidence: 0.4,
    sourceMessageId: `message_${contributedAt}_${hexDigit}`,
    sourceRunId: null,
    scope: 'global',
    originConversationId: null,
    originThreadId: null,
    originTaskId: null,
    sourceTurnId: `turn_${contributedAt}_${hexDigit}`,
    sourceSummary: null,
    importance: 0.3,
    decayPolicy: 'normal',
    expiresAt: null,
    validAt: contributedAt,
    pinned: false,
    sourceActorId: null,
    retrievability: 0.6,
    stability: 0.5,
    decayRate: 0.03,
    reviewState: 'auto',
    sensitivityFloor: 'normal',
    memoryKind: 'semantic_fact',
    supersedePrior: false,
    now: contributedAt,
    ...overrides,
  };
  return {
    contributionId: contributionId(hexDigit),
    contributedAt,
    payload: {
      version: MEMORY_FACT_CONTRIBUTION_PAYLOAD_VERSION,
      operation: { kind: 'record' },
      applicability: {
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        personaId: null,
        ...applicability,
      },
      input,
    },
    supersessionSnapshot: null,
  };
}

function exactReplacementContribution(
  hexDigit: string,
  contributedAt: number,
): VerifiedFactContributionProjectionInput {
  const base = contribution(hexDigit, contributedAt, {
    pinned: true,
    reviewState: 'verified',
    supersedePrior: false,
  });
  return {
    ...base,
    payload: {
      ...base.payload,
      operation: {
        kind: 'exact_replacement',
        expectedCurrentFactId: 'fact_projection_predecessor',
      },
    },
    supersessionSnapshot: {
      contribution_id: base.contributionId,
      successor_fact_id: FACT_ID,
      superseded_at: contributedAt,
      snapshot_version: 1,
      pinned_input_explicit: 1,
      review_state_input_explicit: 1,
      successor_pinned_baseline: 1,
      successor_review_state_baseline: 'verified',
      successor_sensitivity_floor: 'sensitive',
      successor_sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    },
  };
}

function project(
  contributions: ReadonlyArray<VerifiedFactContributionProjectionInput>,
  explicitProjection?: FactContributionExplicitProjection,
) {
  return projectFactFromSurvivingContributions({
    factId: FACT_ID,
    contributions,
    classifierContext: CLASSIFIER_CONTEXT,
    ...(explicitProjection ? { explicitProjection } : {}),
  });
}

describe('fact contribution projection', () => {
  it('uses contributed time and then ordinal contribution id, independent of arrival order', () => {
    const earliest = contribution('1', 100, {
      attributes: { first: true, shared: '最初' },
      sourceSummary: '最初の要約',
    });
    const sameTimeEarlierId = contribution('a', 200, {
      attributes: { middle: true, shared: 'وسط' },
      confidence: 0.8,
    });
    const sameTimeLaterId = contribution('b', 200, {
      attributes: { last: true, shared: 'الأخير' },
      importance: 0.9,
    });

    const projection = project([sameTimeLaterId, earliest, sameTimeEarlierId]);

    expect(projection.attributes).toEqual({
      first: true,
      middle: true,
      last: true,
      shared: 'الأخير',
    });
    expect(projection.sourceMessageId).toBe(earliest.payload.input.sourceMessageId);
    expect(projection.firstContributionId).toBe(earliest.contributionId);
    expect(projection.lastContributionId).toBe(sameTimeLaterId.contributionId);
    expect(projection.sourceSummary).toBe('最初の要約');
    expect(projection.createdAt).toBe(100);
    expect(projection.updatedAt).toBe(200);
    expect(projection.repeatedMentionCount).toBe(2);
    expect(projection.lastReinforcedAt).toBe(200);
    expect(projection.confidence).toBe(0.8);
    expect(projection.importance).toBe(0.9);
  });

  it('reduces a delayed older arrival to the same projection as canonical arrival', () => {
    const delayedOldest = contribution('c', 100, {
      sourceMessageId: 'message_delayed_oldest',
      decayPolicy: 'fast',
      attributes: { order: 'oldest' },
    });
    const firstArrival = contribution('d', 200, {
      attributes: { order: 'middle' },
    });
    const secondArrival = contribution('e', 300, {
      attributes: { order: 'latest' },
    });

    expect(project([firstArrival, secondArrival, delayedOldest])).toEqual(
      project([delayedOldest, firstArrival, secondArrival]),
    );
    expect(project([firstArrival, secondArrival, delayedOldest])).toMatchObject({
      sourceMessageId: 'message_delayed_oldest',
      decayPolicy: 'fast',
      attributes: { order: 'latest' },
      createdAt: 100,
      updatedAt: 300,
    });
  });

  it('uses the exact replacement snapshot as a monotonic projection baseline', () => {
    const projection = project([exactReplacementContribution('f', 100)]);

    expect(projection).toMatchObject({
      pinned: true,
      reviewState: 'verified',
      sensitivity: 'sensitive',
      sensitivityPolicyVersion: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
    });
  });

  it('preserves the highest declared floor across contribution replay', () => {
    const personal = contribution('1', 100, { sensitivityFloor: 'personal' });
    const normal = contribution('2', 200, { sensitivityFloor: 'normal' });
    const sensitive = contribution('3', 300, { sensitivityFloor: 'sensitive' });

    expect(project([normal, personal])).toMatchObject({
      sensitivityFloor: 'personal',
      sensitivity: 'personal',
    });
    expect(project([sensitive, normal, personal])).toMatchObject({
      sensitivityFloor: 'sensitive',
      sensitivity: 'sensitive',
    });
  });

  it('uses a superseding record snapshot when that sealed operation authorizes edges', () => {
    const base = contribution('d', 90, {
      pinned: true,
      reviewState: 'stale',
      supersedePrior: true,
    });
    const supersedingRecord = {
      ...base,
      supersessionSnapshot: {
        contribution_id: base.contributionId,
        successor_fact_id: FACT_ID,
        superseded_at: base.contributedAt,
        snapshot_version: 1,
        pinned_input_explicit: 1,
        review_state_input_explicit: 1,
        successor_pinned_baseline: 1,
        successor_review_state_baseline: 'stale',
        successor_sensitivity_floor: 'personal',
        successor_sensitivity_policy_version: MEMORY_FACT_SENSITIVITY_POLICY_VERSION,
      },
    };

    expect(project([supersedingRecord])).toMatchObject({
      pinned: true,
      reviewState: 'stale',
      sensitivity: 'personal',
    });
  });

  it('accepts a snapshot-free exact duplicate only when it targets the aggregate fact', () => {
    const base = contribution('e', 100);
    const selfTarget = {
      ...base,
      payload: {
        ...base.payload,
        operation: {
          kind: 'exact_replacement' as const,
          expectedCurrentFactId: FACT_ID,
        },
      },
    };

    expect(project([selfTarget])).toMatchObject({
      firstContributionId: selfTarget.contributionId,
      repeatedMentionCount: 0,
    });
  });

  it('applies explicit intent only after deriving all contribution state', () => {
    const base = contribution('1', 100, {
      pinned: true,
      reviewState: 'pending_review',
    });
    const later = contribution('2', 200, { reviewState: 'conflicted' });
    const derived = project([later, base]);
    const effective = project([later, base], {
      pinnedOverride: false,
      reviewStateOverride: 'verified',
      sensitivityFloor: 'sensitive',
      explicitInvalidatedAt: null,
    });

    expect(derived).toMatchObject({ pinned: true, reviewState: 'conflicted' });
    expect(effective).toMatchObject({
      pinned: false,
      reviewState: 'verified',
      sensitivity: 'sensitive',
    });
    expect(derived).toMatchObject({ pinned: true, reviewState: 'conflicted' });
  });

  it('rejects rematerialization of an explicitly invalidated fact', () => {
    expect(() =>
      project([contribution('1', 100)], {
        pinnedOverride: null,
        reviewStateOverride: null,
        sensitivityFloor: null,
        explicitInvalidatedAt: 150,
      }),
    ).toThrow('memory_fact_contribution_projection_explicitly_invalidated');
  });

  it('overlays explicit intent for retirement without clearing lifecycle invalidation', () => {
    const derived = project([contribution('1', 100)]);

    expect(
      overlayFactContributionExplicitProjectionForRetirement(derived, {
        pinnedOverride: true,
        reviewStateOverride: 'rejected',
        sensitivityFloor: 'restricted',
        explicitInvalidatedAt: 150,
      }),
    ).toMatchObject({
      pinned: true,
      reviewState: 'rejected',
      sensitivity: 'restricted',
    });
    expect(derived).toMatchObject({ pinned: false, reviewState: 'auto' });
  });

  it('removing the base shifts base-owned fields to the earliest survivor', () => {
    const base = contribution('1', 100, {
      attributes: { baseOnly: true, layer: 'base' },
      sourceMessageId: 'message_base',
      sourceSummary: 'base summary',
      decayPolicy: 'fast',
      expiresAt: 1_000,
      pinned: true,
    });
    const middle = contribution('2', 200, {
      attributes: { middleOnly: true, layer: 'middle' },
      sourceMessageId: 'message_middle',
      sourceSummary: 'middle summary',
      decayPolicy: 'slow',
      expiresAt: 2_000,
    });
    const last = contribution('3', 300, {
      attributes: { lastOnly: true, layer: 'last' },
    });

    const projection = project([last, middle]);

    expect(projection).toMatchObject({
      sourceMessageId: 'message_middle',
      sourceSummary: 'middle summary',
      decayPolicy: 'slow',
      expiresAt: 2_000,
      pinned: false,
      createdAt: 200,
      repeatedMentionCount: 1,
    });
    expect(projection.attributes).toEqual({
      middleOnly: true,
      lastOnly: true,
      layer: 'last',
    });
    expect(project([base, middle, last]).attributes).toHaveProperty('baseOnly', true);
  });

  it('removing a middle contribution removes only its surviving influence', () => {
    const base = contribution('1', 100, {
      attributes: { layer: 'base', retained: 'base' },
      importance: 0.2,
    });
    const middle = contribution('2', 200, {
      attributes: { layer: 'middle', middleOnly: true },
      importance: 0.95,
    });
    const last = contribution('3', 300, {
      attributes: { layer: 'last', lastOnly: true },
      importance: 0.7,
    });

    const projection = project([last, base]);

    expect(projection.attributes).toEqual({
      layer: 'last',
      retained: 'base',
      lastOnly: true,
    });
    expect(projection.importance).toBe(0.7);
    expect(projection.repeatedMentionCount).toBe(1);
    expect(projection.lastReinforcedAt).toBe(300);
    expect(project([base, middle, last]).importance).toBe(0.95);
  });

  it('removing the last contribution restores the prior last-writer projection', () => {
    const base = contribution('1', 100, {
      attributes: { layer: 'base' },
      confidence: 0.2,
    });
    const middle = contribution('2', 200, {
      attributes: { layer: 'middle', middleOnly: true },
      confidence: 0.6,
    });
    const last = contribution('3', 300, {
      attributes: { layer: 'last', lastOnly: true },
      confidence: 0.9,
    });

    const projection = project([middle, base]);

    expect(projection.attributes).toEqual({ layer: 'middle', middleOnly: true });
    expect(projection.confidence).toBe(0.6);
    expect(projection.updatedAt).toBe(200);
    expect(projection.lastReinforcedAt).toBe(200);
    expect(projection.repeatedMentionCount).toBe(1);
    expect(project([base, middle, last]).attributes).toHaveProperty('lastOnly', true);
  });

  it('uses the exported pairwise primitive for the same canonical reduction rule', () => {
    const base = contribution('1', 100, { attributes: { layer: 'base' } });
    const later = contribution('2', 200, {
      attributes: { layer: 'later' },
      reviewState: 'stale',
    });
    const baseline = project([base]);

    expect(mergeFactContributionProjection(baseline, FACT_ID, later, CLASSIFIER_CONTEXT)).toEqual(
      project([later, base]),
    );
  });

  it('rejects pairwise use when the incoming contribution is not canonically later', () => {
    const sameTimeEarlier = contribution('1', 200);
    const sameTimeLater = contribution('2', 200);
    const delayedOlder = contribution('3', 100);
    const baseline = project([sameTimeLater]);

    expect(() =>
      mergeFactContributionProjection(baseline, FACT_ID, sameTimeEarlier, CLASSIFIER_CONTEXT),
    ).toThrow('memory_fact_contribution_projection_order_invalid');
    expect(() =>
      mergeFactContributionProjection(baseline, FACT_ID, delayedOlder, CLASSIFIER_CONTEXT),
    ).toThrow('memory_fact_contribution_projection_order_invalid');
  });

  it('does not mutate or retain mutable aliases into mixed-script payloads', () => {
    const first = contribution('1', 100, {
      attributes: {
        色: { value: '青' },
        تفضيل: ['هادئ', '🌍'],
        shared: 'начало',
      },
      sourceSummary: 'ملخص 日本語 resumo',
    });
    const second = contribution('2', 200, {
      attributes: { shared: 'النهاية', ключ: 'значение' },
    });
    const inputs = [second, first];
    const before = JSON.stringify(inputs);

    const projection = project(inputs);

    expect(JSON.stringify(inputs)).toBe(before);
    expect(inputs.map((entry) => entry.contributionId)).toEqual([
      second.contributionId,
      first.contributionId,
    ]);
    expect(projection.attributes).toEqual({
      色: { value: '青' },
      تفضيل: ['هادئ', '🌍'],
      shared: 'النهاية',
      ключ: 'значение',
    });
    (projection.attributes['色'] as { value: string }).value = 'changed';
    expect((first.payload.input.attributes['色'] as { value: string }).value).toBe('青');
  });

  it('rejects malformed or duplicate contribution identities and timestamp mismatches', () => {
    const valid = contribution('1', 100);
    const malformed = { ...valid, contributionId: 'mfc_not-hex' };
    const timestampMismatch = { ...valid, contributedAt: 101 };

    expect(() => project([malformed])).toThrow('memory_fact_contribution_projection_id_invalid');
    expect(() => project([valid, { ...valid }])).toThrow(
      'memory_fact_contribution_projection_duplicate',
    );
    expect(() => project([timestampMismatch])).toThrow(
      'memory_fact_contribution_projection_timestamp_mismatch',
    );
  });

  it('rejects mismatched aggregate identity, payload identity, and replacement snapshots', () => {
    const valid = contribution('1', 100);
    const unrelated = contribution('2', 200, { objectText: '別_مختلف' });
    const exact = exactReplacementContribution('3', 300);
    const wrongSuccessor = {
      ...exact,
      supersessionSnapshot: {
        ...exact.supersessionSnapshot!,
        successor_fact_id: 'fact_other_successor',
      },
    };
    const missingSnapshot = { ...exact, supersessionSnapshot: null };
    const selfTargetWithSnapshot = {
      ...exact,
      payload: {
        ...exact.payload,
        operation: {
          kind: 'exact_replacement' as const,
          expectedCurrentFactId: FACT_ID,
        },
      },
    };

    expect(() =>
      projectFactFromSurvivingContributions({
        factId: ' invalid',
        contributions: [valid],
        classifierContext: CLASSIFIER_CONTEXT,
      }),
    ).toThrow('memory_fact_contribution_projection_fact_id_invalid');
    expect(() => project([valid, unrelated])).toThrow(
      'memory_fact_contribution_projection_identity_mismatch',
    );
    expect(() => project([wrongSuccessor])).toThrow(
      'memory_fact_contribution_projection_snapshot_invalid',
    );
    expect(() => project([missingSnapshot])).toThrow(
      'memory_fact_contribution_projection_snapshot_missing',
    );
    expect(() => project([selfTargetWithSnapshot])).toThrow(
      'memory_fact_contribution_projection_snapshot_invalid',
    );
  });
});
