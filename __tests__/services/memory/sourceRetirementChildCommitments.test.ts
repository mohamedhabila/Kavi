import {
  assertSourceRetirementChildCommitment,
  buildSourceRetirementClosedSourcesCommitment,
  buildSourceRetirementContributionIdsCommitment,
  buildSourceRetirementFactIdsCommitment,
  buildSourceRetirementRequestedSourcesCommitment,
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS,
} from '../../../src/services/memory/sourceRetirementChildCommitments';
import type { PersistedExactMemorySourceIdentity } from '../../../src/services/memory/exactMemorySourceIdentity';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

const GROUP_A = 'retirement-α';
const GROUP_B = 'retirement-β';
const CONTRIBUTION_A = `mfc_${'a'.repeat(64)}`;
const CONTRIBUTION_B = `mfc_${'b'.repeat(64)}`;

function source(
  overrides: Partial<PersistedExactMemorySourceIdentity> = {},
): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: 'owner-مستخدم',
    memoryConversationId: 'conversation-会話',
    sourceThreadId: 'thread-ä',
    taskId: '',
    sourceKind: 'message',
    sourceId: 'message-Z',
    ...overrides,
  };
}

function contributionId(index: number): string {
  return `mfc_${index.toString(16).padStart(64, '0')}`;
}

describe('source retirement child commitments', () => {
  it('commits exact mixed-script source tuples in ECMAScript ordinal field order', () => {
    const sources = Object.freeze([
      Object.freeze(source({ sourceKind: 'turn', sourceId: 'ä' })),
      Object.freeze(source({ sourceKind: 'message', sourceId: 'β' })),
      Object.freeze(source({ sourceKind: 'run', sourceId: '消息' })),
      Object.freeze(source({ sourceKind: 'message', sourceId: 'Z' })),
    ]);
    const originalOrder = sources.map((row) => `${row.sourceKind}:${row.sourceId}`);
    const actual = buildSourceRetirementRequestedSourcesCommitment({
      retirementGroupId: GROUP_A,
      sources,
    });
    const expectedProjection = [
      'kavi.memory-source-retirement.requested-sources.v1',
      1,
      GROUP_A,
      [
        ['owner-مستخدم', 'conversation-会話', 'thread-ä', '', 'message', 'Z'],
        ['owner-مستخدم', 'conversation-会話', 'thread-ä', '', 'message', 'β'],
        ['owner-مستخدم', 'conversation-会話', 'thread-ä', '', 'run', '消息'],
        ['owner-مستخدم', 'conversation-会話', 'thread-ä', '', 'turn', 'ä'],
      ],
    ];

    expect(actual).toEqual({
      version: 1,
      count: 4,
      sha256: sha256HexUtf8(JSON.stringify(expectedProjection)),
    });
    expect(Object.isFrozen(actual)).toBe(true);
    expect(sources.map((row) => `${row.sourceKind}:${row.sourceId}`)).toEqual(originalOrder);
  });

  it('is order-independent for all four child-set projections', () => {
    const firstSources = [
      source({ sourceKind: 'turn', sourceId: 'turn-β' }),
      source({ sourceKind: 'message', sourceId: 'message-Z' }),
    ];
    const secondSources = [...firstSources].reverse();
    const firstFacts = ['事实', 'Z', 'β'];

    expect(
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: firstSources,
      }),
    ).toEqual(
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: secondSources,
      }),
    );
    expect(
      buildSourceRetirementClosedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: firstSources,
      }),
    ).toEqual(
      buildSourceRetirementClosedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: secondSources,
      }),
    );
    expect(
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: [CONTRIBUTION_B, CONTRIBUTION_A],
      }),
    ).toEqual(
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: [CONTRIBUTION_A, CONTRIBUTION_B],
      }),
    );
    expect(
      buildSourceRetirementFactIdsCommitment({
        retirementGroupId: GROUP_A,
        factIds: firstFacts,
      }),
    ).toEqual(
      buildSourceRetirementFactIdsCommitment({
        retirementGroupId: GROUP_A,
        factIds: [...firstFacts].reverse(),
      }),
    );
  });

  it('domain-separates all child sets and binds them to the exact retirement group', () => {
    const requested = buildSourceRetirementRequestedSourcesCommitment({
      retirementGroupId: GROUP_A,
      sources: [source()],
    });
    const closed = buildSourceRetirementClosedSourcesCommitment({
      retirementGroupId: GROUP_A,
      sources: [source()],
    });
    const contribution = buildSourceRetirementContributionIdsCommitment({
      retirementGroupId: GROUP_A,
      contributionIds: [],
    });
    const fact = buildSourceRetirementFactIdsCommitment({
      retirementGroupId: GROUP_A,
      factIds: [],
    });
    const otherGroup = buildSourceRetirementRequestedSourcesCommitment({
      retirementGroupId: GROUP_B,
      sources: [source()],
    });

    expect(
      new Set([requested.sha256, closed.sha256, contribution.sha256, fact.sha256]).size,
    ).toBe(4);
    expect(otherGroup.sha256).not.toBe(requested.sha256);
    expect(() => assertSourceRetirementChildCommitment(requested, closed)).toThrow(
      'memory_source_retirement_child_commitment_mismatch',
    );
    expect(() => assertSourceRetirementChildCommitment(requested, otherGroup)).toThrow(
      'memory_source_retirement_child_commitment_mismatch',
    );
  });

  it('verifies exact rows, count, version, and hash and rejects tampering', () => {
    const expected = buildSourceRetirementClosedSourcesCommitment({
      retirementGroupId: GROUP_A,
      sources: [source()],
    });
    const tamperedRows = buildSourceRetirementClosedSourcesCommitment({
      retirementGroupId: GROUP_A,
      sources: [source({ sourceId: 'message-tampered' })],
    });

    expect(() => assertSourceRetirementChildCommitment(expected, expected)).not.toThrow();
    expect(() => assertSourceRetirementChildCommitment(expected, tamperedRows)).toThrow(
      'memory_source_retirement_child_commitment_mismatch',
    );
    expect(() =>
      assertSourceRetirementChildCommitment({ ...expected, count: 2 }, expected),
    ).toThrow('memory_source_retirement_child_commitment_mismatch');
    expect(() =>
      assertSourceRetirementChildCommitment({ ...expected, sha256: '0'.repeat(64) }, expected),
    ).toThrow('memory_source_retirement_child_commitment_mismatch');
    expect(() =>
      assertSourceRetirementChildCommitment({ ...expected, version: 2 }, expected),
    ).toThrow('memory_source_retirement_child_commitment_metadata_invalid');
  });

  it('rejects malformed sealed commitment metadata', () => {
    const expected = buildSourceRetirementFactIdsCommitment({
      retirementGroupId: GROUP_A,
      factIds: [],
    });
    const malformed: unknown[] = [
      null,
      { ...expected, extra: true },
      { ...expected, count: -1 },
      { ...expected, count: 1.5 },
      { ...expected, count: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources + 1 },
      { ...expected, sha256: 'A'.repeat(64) },
      { ...expected, sha256: '0'.repeat(63) },
    ];

    for (const candidate of malformed) {
      expect(() => assertSourceRetirementChildCommitment(candidate, expected)).toThrow(
        'memory_source_retirement_child_commitment_metadata_invalid',
      );
    }
  });

  it('requires non-empty requested and closed source sets but commits empty opaque fences', () => {
    expect(() =>
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: [],
      }),
    ).toThrow('memory_source_retirement_requested_sources_invalid');
    expect(() =>
      buildSourceRetirementClosedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: [],
      }),
    ).toThrow('memory_source_retirement_closed_sources_invalid');

    const contribution = buildSourceRetirementContributionIdsCommitment({
      retirementGroupId: GROUP_A,
      contributionIds: [],
    });
    const fact = buildSourceRetirementFactIdsCommitment({
      retirementGroupId: GROUP_A,
      factIds: [],
    });
    expect(contribution.count).toBe(0);
    expect(fact.count).toBe(0);
    expect(contribution.sha256).not.toBe(fact.sha256);
  });

  it('rejects duplicate exact source tuples and duplicate opaque IDs', () => {
    expect(() =>
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: [source(), source()],
      }),
    ).toThrow('memory_source_retirement_requested_sources_invalid');
    expect(() =>
      buildSourceRetirementClosedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: [source(), source()],
      }),
    ).toThrow('memory_source_retirement_closed_sources_invalid');
    expect(() =>
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: [CONTRIBUTION_A, CONTRIBUTION_A],
      }),
    ).toThrow('memory_source_retirement_contribution_ids_invalid');
    expect(() =>
      buildSourceRetirementFactIdsCommitment({
        retirementGroupId: GROUP_A,
        factIds: ['fact-1', 'fact-1'],
      }),
    ).toThrow('memory_source_retirement_fact_ids_invalid');
  });

  it('rejects malformed or normalized persisted source identities', () => {
    const invalidSources: unknown[] = [
      { ...source(), extra: true },
      { ...source(), taskId: null },
      { ...source(), taskId: ' task-1' },
      { ...source(), memoryOwnerId: ' owner' },
      { ...source(), memoryConversationId: '' },
      { ...source(), sourceThreadId: 'thread\n1' },
      { ...source(), sourceKind: 'tool' },
      { ...source(), sourceId: 'message 1' },
      {
        memoryOwnerId: source().memoryOwnerId,
        memoryConversationId: source().memoryConversationId,
        sourceThreadId: source().sourceThreadId,
        sourceKind: source().sourceKind,
        sourceId: source().sourceId,
      },
    ];

    for (const candidate of invalidSources) {
      expect(() =>
        buildSourceRetirementRequestedSourcesCommitment({
          retirementGroupId: GROUP_A,
          sources: [candidate] as never,
        }),
      ).toThrow('memory_source_retirement_requested_sources_invalid');
    }
  });

  it('rejects malformed outer inputs, group IDs, contribution IDs, and fact IDs', () => {
    expect(() =>
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: [source()],
        extra: true,
      } as never),
    ).toThrow('memory_source_retirement_requested_sources_commitment_input_invalid');
    expect(() =>
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: 'retirement group',
        sources: [source()],
      }),
    ).toThrow('memory_source_retirement_child_commitment_group_id_invalid');
    expect(() =>
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: [`mfc_${'A'.repeat(64)}`],
      }),
    ).toThrow('memory_source_retirement_contribution_ids_invalid');
    expect(() =>
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: [`mfc_${'a'.repeat(63)}`],
      }),
    ).toThrow('memory_source_retirement_contribution_ids_invalid');
    expect(() =>
      buildSourceRetirementFactIdsCommitment({
        retirementGroupId: GROUP_A,
        factIds: ['fact 1'],
      }),
    ).toThrow('memory_source_retirement_fact_ids_invalid');
  });

  it('rejects every child set above its explicit bound', () => {
    expect(() =>
      buildSourceRetirementRequestedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: Array.from(
          { length: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.requestedSources + 1 },
          (_, index) => source({ sourceId: `requested-${index}` }),
        ),
      }),
    ).toThrow('memory_source_retirement_requested_sources_invalid');
    expect(() =>
      buildSourceRetirementClosedSourcesCommitment({
        retirementGroupId: GROUP_A,
        sources: Array.from(
          { length: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredSources + 1 },
          (_, index) => source({ sourceId: `closed-${index}` }),
        ),
      }),
    ).toThrow('memory_source_retirement_closed_sources_invalid');
    expect(() =>
      buildSourceRetirementContributionIdsCommitment({
        retirementGroupId: GROUP_A,
        contributionIds: Array.from(
          { length: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredContributions + 1 },
          (_, index) => contributionId(index),
        ),
      }),
    ).toThrow('memory_source_retirement_contribution_ids_invalid');
    expect(() =>
      buildSourceRetirementFactIdsCommitment({
        retirementGroupId: GROUP_A,
        factIds: Array.from(
          { length: MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS.retiredFacts + 1 },
          (_, index) => `fact-${index}`,
        ),
      }),
    ).toThrow('memory_source_retirement_fact_ids_invalid');
  });
});
