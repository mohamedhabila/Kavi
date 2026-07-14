import type { VerifiedFactContributionAggregate } from '../../../src/services/memory/factContributionAggregateTypes';
import type { PersistedExactMemorySourceIdentity } from '../../../src/services/memory/exactMemorySourceIdentity';
import type { FactContributionExplicitProjection } from '../../../src/services/memory/facts/factContributionProjection';
import { planExactSourceRetirement } from '../../../src/services/memory/sourceRetirementPlanner';
import { MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS } from '../../../src/services/memory/sourceRetirementPlan';

const OWNER_ID = 'owner_retirement_planner';
const CONVERSATION_ID = 'conversation_retirement_planner';
const THREAD_ID = 'thread_retirement_planner';

interface AggregateOptions {
  factId?: string;
  contributedAt?: number;
  factCreatedAt?: number;
  invalidAt?: number | null;
  deletedAt?: number | null;
  taskId?: string;
  aliases?: ReadonlyArray<{ sourceKind: 'message' | 'turn' | 'run'; sourceId: string }>;
  predecessorFactIds?: ReadonlyArray<string>;
  attributes?: Record<string, unknown>;
  pinned?: boolean;
  reviewState?: 'auto' | 'verified' | 'pending_review' | 'stale' | 'conflicted' | 'rejected';
  sensitivity?: 'normal' | 'personal' | 'sensitive' | 'restricted';
  explicitProjection?: FactContributionExplicitProjection | null;
}

function contributionId(index: number): string {
  return `mfc_${index.toString(16).padStart(64, '0')}`;
}

function exactSource(input: {
  sourceKind: 'message' | 'turn' | 'run';
  sourceId: string;
  taskId?: string;
}): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: OWNER_ID,
    memoryConversationId: CONVERSATION_ID,
    sourceThreadId: THREAD_ID,
    taskId: input.taskId ?? '',
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
  };
}

function aggregate(
  index: number,
  options: AggregateOptions = {},
): VerifiedFactContributionAggregate {
  const factId = options.factId ?? `fact_${index}`;
  const contributedAt = options.contributedAt ?? 100 + index;
  const factCreatedAt = options.factCreatedAt ?? contributedAt;
  const aliases = options.aliases ?? [
    { sourceKind: 'message' as const, sourceId: `message_${index}` },
  ];
  const predecessorFactIds = options.predecessorFactIds ?? [];
  const id = contributionId(index);
  const snapshot =
    predecessorFactIds.length === 0
      ? null
      : {
          contribution_id: id,
          successor_fact_id: factId,
          superseded_at: contributedAt,
          snapshot_version: 1,
          pinned_input_explicit: 0,
          review_state_input_explicit: 0,
          successor_pinned_baseline: 0,
          successor_review_state_baseline: 'auto',
          successor_sensitivity_floor: 'normal',
          successor_sensitivity_policy_version: 1,
        };
  const predicate = `state_${factId}`;
  const objectText = `value_${factId}`;
  return {
    contributionId: id,
    factId,
    memoryOwnerId: OWNER_ID,
    sourceScope: {
      memoryOwnerId: OWNER_ID,
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      taskId: options.taskId ?? '',
    },
    producer: {
      producerId: 'source_retirement_planner_test',
      producerEventId: `event_${index}`,
    },
    contributedAt,
    payload: {
      version: 1,
      operation: { kind: 'record' },
      applicability: {
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        personaId: null,
      },
      input: {
        subjectId: 'subject_retirement_planner',
        predicate,
        objectText,
        objectEntityId: null,
        attributes: options.attributes ?? { contribution: index },
        confidence: 0.7,
        sourceMessageId: null,
        sourceRunId: null,
        scope: 'global',
        originConversationId: null,
        originThreadId: null,
        originTaskId: null,
        sourceTurnId: null,
        sourceSummary: null,
        importance: 0.6,
        decayPolicy: 'normal',
        expiresAt: null,
        validAt: factCreatedAt,
        pinned: false,
        sourceActorId: null,
        retrievability: 0.8,
        stability: 0.5,
        decayRate: 0.03,
        reviewState: 'auto',
        memoryKind: 'semantic_fact',
        supersedePrior: predecessorFactIds.length > 0,
        now: contributedAt,
      },
    },
    sourceAliases: aliases,
    supersessionPlan: {
      contributionId: id,
      snapshot,
      edges: predecessorFactIds.map((predecessorFactId) => ({
        contribution_id: id,
        predecessor_fact_id: predecessorFactId,
        successor_fact_id: factId,
        superseded_at: contributedAt,
      })),
      commitment: {
        version: 1,
        count: predecessorFactIds.length === 0 ? 0 : predecessorFactIds.length + 1,
        sha256: '0'.repeat(64),
      },
    },
    factEvidence: {
      id: factId,
      memoryOwnerId: OWNER_ID,
      memoryKind: 'semantic_fact',
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      personaId: null,
      subjectId: 'subject_retirement_planner',
      predicate,
      objectText,
      objectEntityId: null,
      createdAt: factCreatedAt,
      invalidAt: options.invalidAt ?? null,
      deletedAt: options.deletedAt ?? null,
      pinned: options.pinned ?? false,
      reviewState: options.reviewState ?? 'auto',
      sensitivity: options.sensitivity ?? 'normal',
      sensitivityPolicyVersion: 1,
    },
    classifierContext: { subject: null, subjectType: null },
    explicitProjection: options.explicitProjection ?? null,
  };
}

function sourceIds(plan: ReturnType<typeof planExactSourceRetirement>): string[] {
  return plan.closedSources.map(
    (source) => `${source.taskId}:${source.sourceKind}:${source.sourceId}`,
  );
}

describe('exact source retirement fixed-point planner', () => {
  it('closes every alias and every contribution that shares a newly closed exact tuple', () => {
    const first = aggregate(1, {
      factId: 'fact_alias_a',
      aliases: [
        { sourceKind: 'message', sourceId: 'message_seed' },
        { sourceKind: 'turn', sourceId: 'turn_shared' },
      ],
    });
    const second = aggregate(2, {
      factId: 'fact_alias_b',
      aliases: [
        { sourceKind: 'turn', sourceId: 'turn_shared' },
        { sourceKind: 'run', sourceId: 'run_closed_transitively' },
      ],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [exactSource({ sourceKind: 'message', sourceId: 'message_seed' })],
      activeAggregates: [second, first],
    });

    expect(plan.newlyRetiredContributionIds).toEqual([first.contributionId, second.contributionId]);
    expect(plan.tombstones.map(({ factId }) => factId)).toEqual(['fact_alias_a', 'fact_alias_b']);
    expect(sourceIds(plan)).toEqual([
      ':message:message_seed',
      ':run:run_closed_transitively',
      ':turn:turn_shared',
    ]);
    expect(plan.survivors).toEqual([]);
  });

  it('retires forward dependents only after the predecessor loses every contribution', () => {
    const predecessor = aggregate(1, {
      factId: 'fact_chain_predecessor',
      contributedAt: 100,
      invalidAt: 200,
      aliases: [{ sourceKind: 'message', sourceId: 'message_chain_seed' }],
    });
    const successor = aggregate(2, {
      factId: 'fact_chain_successor',
      contributedAt: 200,
      factCreatedAt: 200,
      invalidAt: 300,
      predecessorFactIds: ['fact_chain_predecessor'],
      aliases: [{ sourceKind: 'turn', sourceId: 'turn_chain_middle' }],
    });
    const dependent = aggregate(3, {
      factId: 'fact_chain_dependent',
      contributedAt: 300,
      factCreatedAt: 300,
      predecessorFactIds: ['fact_chain_successor'],
      aliases: [{ sourceKind: 'run', sourceId: 'run_chain_end' }],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [exactSource({ sourceKind: 'message', sourceId: 'message_chain_seed' })],
      activeAggregates: [dependent, predecessor, successor],
    });

    expect(plan.newlyRetiredContributionIds).toEqual([
      predecessor.contributionId,
      successor.contributionId,
      dependent.contributionId,
    ]);
    expect(plan.tombstones.map(({ factId }) => factId)).toEqual([
      'fact_chain_dependent',
      'fact_chain_predecessor',
      'fact_chain_successor',
    ]);
    expect(sourceIds(plan)).toEqual([
      ':message:message_chain_seed',
      ':run:run_chain_end',
      ':turn:turn_chain_middle',
    ]);
  });

  it('preserves forward dependents while the predecessor still has a survivor', () => {
    const retired = aggregate(1, {
      factId: 'fact_partial_predecessor',
      contributedAt: 100,
      factCreatedAt: 100,
      invalidAt: 200,
      aliases: [{ sourceKind: 'message', sourceId: 'message_partial_remove' }],
    });
    const surviving = aggregate(2, {
      factId: 'fact_partial_predecessor',
      contributedAt: 150,
      factCreatedAt: 100,
      invalidAt: 200,
      aliases: [{ sourceKind: 'message', sourceId: 'message_partial_keep' }],
    });
    const dependent = aggregate(3, {
      factId: 'fact_partial_dependent',
      contributedAt: 200,
      factCreatedAt: 200,
      predecessorFactIds: ['fact_partial_predecessor'],
      aliases: [{ sourceKind: 'run', sourceId: 'run_partial_dependent' }],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_partial_remove' }),
      ],
      activeAggregates: [dependent, retired, surviving],
    });

    expect(plan.newlyRetiredContributionIds).toEqual([retired.contributionId]);
    expect(plan.tombstones).toEqual([]);
    expect(plan.survivors).toEqual([
      {
        factId: 'fact_partial_dependent',
        survivingContributionIds: [dependent.contributionId],
      },
      {
        factId: 'fact_partial_predecessor',
        survivingContributionIds: [surviving.contributionId],
      },
    ]);
    expect(plan.rematerializations).toHaveLength(1);
    expect(plan.rematerializations[0]!.factId).toBe('fact_partial_predecessor');
    expect(plan.reactivations).toEqual([]);
  });

  it('reactivates an invalid predecessor after its final surviving supersession edge retires', () => {
    const predecessor = aggregate(1, {
      factId: 'fact_reactivate',
      contributedAt: 100,
      invalidAt: 200,
      attributes: { nested: { state: '保持' } },
      aliases: [{ sourceKind: 'message', sourceId: 'message_reactivate_keep' }],
    });
    const successor = aggregate(2, {
      factId: 'fact_reactivate_successor',
      contributedAt: 200,
      factCreatedAt: 200,
      predecessorFactIds: ['fact_reactivate'],
      aliases: [{ sourceKind: 'message', sourceId: 'message_reactivate_remove' }],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_reactivate_remove' }),
      ],
      activeAggregates: [successor, predecessor],
    });

    expect(plan.reactivations).toHaveLength(1);
    expect(plan.reactivations[0]).toMatchObject({
      factId: 'fact_reactivate',
      invalidatedAt: 200,
      survivingContributionIds: [predecessor.contributionId],
      projection: { attributes: { nested: { state: '保持' } } },
    });
    expect(plan.rematerializations).toEqual([]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.reactivations)).toBe(true);
    expect(Object.isFrozen(plan.reactivations[0])).toBe(true);
    expect(Object.isFrozen(plan.reactivations[0]!.survivingContributionIds)).toBe(true);
    expect(Object.isFrozen(plan.reactivations[0]!.projection)).toBe(true);
    expect(Object.isFrozen(plan.reactivations[0]!.projection.attributes.nested)).toBe(true);
    expect(
      plan.rematerializations.some(({ factId }) => factId === plan.reactivations[0]!.factId),
    ).toBe(false);
  });

  it('does not reactivate while another verified supersession edge survives', () => {
    const predecessor = aggregate(1, {
      factId: 'fact_still_superseded',
      contributedAt: 100,
      invalidAt: 200,
    });
    const removedSuccessor = aggregate(2, {
      factId: 'fact_removed_successor',
      contributedAt: 200,
      factCreatedAt: 200,
      predecessorFactIds: ['fact_still_superseded'],
      aliases: [{ sourceKind: 'message', sourceId: 'message_remove_one_edge' }],
    });
    const survivingSuccessor = aggregate(3, {
      factId: 'fact_surviving_successor',
      contributedAt: 200,
      factCreatedAt: 200,
      predecessorFactIds: ['fact_still_superseded'],
      aliases: [{ sourceKind: 'message', sourceId: 'message_keep_one_edge' }],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_remove_one_edge' }),
      ],
      activeAggregates: [survivingSuccessor, predecessor, removedSuccessor],
    });

    expect(plan.reactivations).toEqual([]);
    expect(plan.newlyRetiredContributionIds).toEqual([removedSuccessor.contributionId]);
    expect(plan.survivors.map(({ factId }) => factId)).toContain('fact_still_superseded');
  });

  it('never infers reactivation from an invalid flag without a retired exact edge', () => {
    const explicitlyInvalid = aggregate(1, {
      factId: 'fact_explicitly_invalid',
      invalidAt: 150,
    });

    const plan = planExactSourceRetirement({
      requestedSources: [exactSource({ sourceKind: 'message', sourceId: 'message_absent' })],
      activeAggregates: [explicitlyInvalid],
    });

    expect(plan.newlyRetiredContributionIds).toEqual([]);
    expect(plan.reactivations).toEqual([]);
    expect(plan.rematerializations).toEqual([]);
  });

  it('preserves explicitly deleted survivors but still ledgers a zero-survivor deleted fact', () => {
    const removed = aggregate(1, {
      factId: 'fact_explicitly_deleted',
      contributedAt: 100,
      factCreatedAt: 100,
      deletedAt: 300,
      aliases: [{ sourceKind: 'message', sourceId: 'message_deleted_remove' }],
    });
    const kept = aggregate(2, {
      factId: 'fact_explicitly_deleted',
      contributedAt: 200,
      factCreatedAt: 100,
      deletedAt: 300,
      aliases: [{ sourceKind: 'message', sourceId: 'message_deleted_keep' }],
    });

    const partial = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_deleted_remove' }),
      ],
      activeAggregates: [kept, removed],
    });
    expect(partial.survivors).toEqual([
      {
        factId: 'fact_explicitly_deleted',
        survivingContributionIds: [kept.contributionId],
      },
    ]);
    expect(partial.reactivations).toEqual([]);
    expect(partial.rematerializations).toEqual([]);

    const complete = planExactSourceRetirement({
      requestedSources: [exactSource({ sourceKind: 'message', sourceId: 'message_deleted_keep' })],
      activeAggregates: [kept],
    });
    expect(complete.survivors).toEqual([]);
    expect(complete.tombstones).toEqual([
      {
        factId: 'fact_explicitly_deleted',
        newlyRetiredContributionIds: [kept.contributionId],
      },
    ]);
    expect(complete.reactivations).toEqual([]);
    expect(complete.rematerializations).toEqual([]);
  });

  it('never reintroduces an earlier retired payload across sequential active-ledger plans', () => {
    const first = aggregate(1, {
      factId: 'fact_sequential',
      contributedAt: 100,
      factCreatedAt: 100,
      attributes: { firstOnly: 'retire-first' },
      aliases: [{ sourceKind: 'message', sourceId: 'message_sequential_first' }],
    });
    const second = aggregate(2, {
      factId: 'fact_sequential',
      contributedAt: 200,
      factCreatedAt: 100,
      attributes: { secondOnly: 'retire-second' },
      aliases: [{ sourceKind: 'message', sourceId: 'message_sequential_second' }],
    });
    const third = aggregate(3, {
      factId: 'fact_sequential',
      contributedAt: 300,
      factCreatedAt: 100,
      attributes: { thirdOnly: 'keep' },
      aliases: [{ sourceKind: 'message', sourceId: 'message_sequential_third' }],
    });

    const firstPlan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_sequential_first' }),
      ],
      activeAggregates: [third, first, second],
    });
    expect(firstPlan.rematerializations[0]!.projection.attributes).toEqual({
      secondOnly: 'retire-second',
      thirdOnly: 'keep',
    });

    const secondPlan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_sequential_second' }),
      ],
      activeAggregates: [third, second],
    });
    expect(secondPlan.newlyRetiredContributionIds).toEqual([second.contributionId]);
    expect(secondPlan.rematerializations[0]!.projection.attributes).toEqual({
      thirdOnly: 'keep',
    });
    expect(secondPlan.rematerializations[0]!.survivingContributionIds).toEqual([
      third.contributionId,
    ]);
  });

  it('keeps a retired successor dependency out of later active graphs', () => {
    const predecessor = aggregate(1, {
      factId: 'fact_prior_dependency',
      contributedAt: 100,
      invalidAt: 200,
      aliases: [{ sourceKind: 'message', sourceId: 'message_prior_dependency' }],
    });
    const successor = aggregate(2, {
      factId: 'fact_prior_successor',
      contributedAt: 200,
      factCreatedAt: 200,
      predecessorFactIds: ['fact_prior_dependency'],
    });
    const firstPlan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'message_prior_dependency' }),
      ],
      activeAggregates: [successor, predecessor],
    });
    expect(firstPlan.newlyRetiredContributionIds).toEqual([
      predecessor.contributionId,
      successor.contributionId,
    ]);

    const unrelated = aggregate(3, { factId: 'fact_later_active' });
    const laterPlan = planExactSourceRetirement({
      requestedSources: [exactSource({ sourceKind: 'message', sourceId: 'message_absent_later' })],
      activeAggregates: [unrelated],
    });
    expect(laterPlan.newlyRetiredContributionIds).toEqual([]);
    expect(laterPlan.survivors.map(({ factId }) => factId)).toEqual(['fact_later_active']);
    expect(() =>
      planExactSourceRetirement({
        requestedSources: [
          exactSource({ sourceKind: 'message', sourceId: 'message_absent_later' }),
        ],
        activeAggregates: [successor],
      }),
    ).toThrow('memory_source_retirement_plan_graph_incomplete');
  });

  it('keeps identical opaque source ids isolated by their exact task scope', () => {
    const retired = aggregate(1, {
      factId: 'fact_task_a',
      taskId: 'task_a',
      aliases: [{ sourceKind: 'message', sourceId: 'same_opaque_id' }],
    });
    const surviving = aggregate(2, {
      factId: 'fact_task_b',
      taskId: 'task_b',
      aliases: [{ sourceKind: 'message', sourceId: 'same_opaque_id' }],
    });

    const plan = planExactSourceRetirement({
      requestedSources: [
        exactSource({ sourceKind: 'message', sourceId: 'same_opaque_id', taskId: 'task_a' }),
      ],
      activeAggregates: [surviving, retired],
    });

    expect(plan.newlyRetiredContributionIds).toEqual([retired.contributionId]);
    expect(plan.survivors).toEqual([
      {
        factId: 'fact_task_b',
        survivingContributionIds: [surviving.contributionId],
      },
    ]);
  });

  it('uses ordinal mixed-script source ordering without mutating frozen caller arrays', () => {
    const multilingual = aggregate(1, {
      factId: 'fact_multilingual_aliases',
      aliases: [
        { sourceKind: 'message', sourceId: '消息' },
        { sourceKind: 'message', sourceId: 'βeta' },
        { sourceKind: 'message', sourceId: 'Zeta' },
        { sourceKind: 'message', sourceId: 'äther' },
      ],
    });
    const requestedSources = Object.freeze([
      Object.freeze(exactSource({ sourceKind: 'message', sourceId: '消息' })),
      Object.freeze(exactSource({ sourceKind: 'message', sourceId: 'Zeta' })),
    ]);
    const activeAggregates = Object.freeze([multilingual]);

    const plan = planExactSourceRetirement({ requestedSources, activeAggregates });

    expect(plan.closedSources.map(({ sourceId }) => sourceId)).toEqual([
      'Zeta',
      'äther',
      'βeta',
      '消息',
    ]);
    expect(plan.requestedSources.map(({ sourceId }) => sourceId)).toEqual(['Zeta', '消息']);
    expect(requestedSources.map(({ sourceId }) => sourceId)).toEqual(['消息', 'Zeta']);
    expect(activeAggregates[0]).toBe(multilingual);
    expect(Object.isFrozen(plan.requestedSources)).toBe(true);
    expect(Object.isFrozen(plan.requestedSources[0])).toBe(true);
    expect(Object.isFrozen(plan.closedSources)).toBe(true);
    expect(Object.isFrozen(plan.closedSources[0])).toBe(true);
    expect(Object.isFrozen(plan.newlyRetiredContributionIds)).toBe(true);
    expect(Object.isFrozen(plan.tombstones)).toBe(true);
    expect(Object.isFrozen(plan.tombstones[0])).toBe(true);
    expect(Object.isFrozen(plan.tombstones[0]!.newlyRetiredContributionIds)).toBe(true);
  });

  it('rejects duplicate requests, duplicate aggregates, incomplete graphs, and resource overflow', () => {
    const source = exactSource({ sourceKind: 'message', sourceId: 'message_duplicate' });
    const one = aggregate(1);
    expect(() =>
      planExactSourceRetirement({
        requestedSources: [source, { ...source }],
        activeAggregates: [one],
      }),
    ).toThrow('memory_source_retirement_plan_request_invalid');
    expect(() =>
      planExactSourceRetirement({ requestedSources: [source], activeAggregates: [one, one] }),
    ).toThrow('memory_source_retirement_plan_aggregate_invalid');
    expect(() =>
      planExactSourceRetirement({
        requestedSources: [source],
        activeAggregates: [
          { ...one, sourceAliases: [null] } as unknown as VerifiedFactContributionAggregate,
        ],
      }),
    ).toThrow('memory_source_retirement_plan_aggregate_invalid');
    expect(() =>
      planExactSourceRetirement({
        requestedSources: [source],
        activeAggregates: [
          { ...one, payload: null } as unknown as VerifiedFactContributionAggregate,
        ],
      }),
    ).toThrow('memory_fact_contribution_payload_invalid');

    const malformedEdge = aggregate(3, {
      contributedAt: 300,
      predecessorFactIds: ['fact_edge_predecessor'],
    });
    const predecessor = aggregate(4, {
      factId: 'fact_edge_predecessor',
      contributedAt: 100,
      invalidAt: 300,
    });
    expect(() =>
      planExactSourceRetirement({
        requestedSources: [source],
        activeAggregates: [
          {
            ...malformedEdge,
            supersessionPlan: { ...malformedEdge.supersessionPlan, edges: [null] },
          } as unknown as VerifiedFactContributionAggregate,
          predecessor,
        ],
      }),
    ).toThrow('memory_source_retirement_plan_aggregate_invalid');

    const dangling = aggregate(2, {
      contributedAt: 200,
      predecessorFactIds: ['fact_missing_predecessor'],
    });
    expect(() =>
      planExactSourceRetirement({ requestedSources: [source], activeAggregates: [dangling] }),
    ).toThrow('memory_source_retirement_plan_graph_incomplete');

    expect(() =>
      planExactSourceRetirement({
        requestedSources: [source],
        activeAggregates: Array.from(
          { length: MEMORY_SOURCE_RETIREMENT_PLAN_LIMITS.activeAggregates + 1 },
          () => one,
        ),
      }),
    ).toThrow('memory_source_retirement_plan_resource_limit');
  });
});
