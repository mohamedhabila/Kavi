import {
  buildFactContributionSourceChildCommitment,
  buildFactContributionSupersessionChildCommitment,
  type FactContributionSupersessionEdgeCommitmentRow,
  type FactContributionSupersessionSnapshotCommitmentRow,
} from '../../../src/services/memory/factContributionChildCommitments';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

const CONTRIBUTION_A = `mfc_${'a'.repeat(64)}`;
const CONTRIBUTION_B = `mfc_${'b'.repeat(64)}`;
const SCOPE = Object.freeze({
  memoryOwnerId: 'owner-1',
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  taskId: '',
});

function snapshot(
  overrides: Partial<FactContributionSupersessionSnapshotCommitmentRow> = {},
): FactContributionSupersessionSnapshotCommitmentRow {
  return {
    contribution_id: CONTRIBUTION_A,
    successor_fact_id: 'successor-1',
    superseded_at: 1_700_000_000_000,
    snapshot_version: 1,
    pinned_input_explicit: 0,
    review_state_input_explicit: 1,
    successor_pinned_baseline: 1,
    successor_review_state_baseline: 'verified',
    successor_sensitivity_floor: 'personal',
    successor_sensitivity_policy_version: 3,
    ...overrides,
  };
}

function edge(
  predecessorFactId: string,
  overrides: Partial<FactContributionSupersessionEdgeCommitmentRow> = {},
): FactContributionSupersessionEdgeCommitmentRow {
  return {
    contribution_id: CONTRIBUTION_A,
    predecessor_fact_id: predecessorFactId,
    successor_fact_id: 'successor-1',
    superseded_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('fact contribution child commitments', () => {
  it('canonically orders source aliases by ECMAScript ordinal order, including Unicode', () => {
    const actual = buildFactContributionSourceChildCommitment({
      contributionId: CONTRIBUTION_A,
      scope: SCOPE,
      sourceAliases: [
        { sourceKind: 'turn', sourceId: 'ä' },
        { sourceKind: 'run', sourceId: 'run-1' },
        { sourceKind: 'turn', sourceId: 'Z' },
        { sourceKind: 'message', sourceId: 'β' },
      ],
    });
    const expectedProjection = [
      'kavi.memory-fact-contribution.source-children.v1',
      1,
      CONTRIBUTION_A,
      ['owner-1', 'conversation-1', 'thread-1', ''],
      [
        ['message', 'β'],
        ['run', 'run-1'],
        ['turn', 'Z'],
        ['turn', 'ä'],
      ],
    ];

    expect(actual).toEqual({
      version: 1,
      count: 4,
      sha256: sha256HexUtf8(JSON.stringify(expectedProjection)),
    });
    expect(actual).toEqual(
      buildFactContributionSourceChildCommitment({
        contributionId: CONTRIBUTION_A,
        scope: SCOPE,
        sourceAliases: [
          { sourceKind: 'message', sourceId: 'β' },
          { sourceKind: 'run', sourceId: 'run-1' },
          { sourceKind: 'turn', sourceId: 'Z' },
          { sourceKind: 'turn', sourceId: 'ä' },
        ],
      }),
    );
  });

  it('canonically orders every exact supersession edge tuple by ordinal predecessor ID', () => {
    const actual = buildFactContributionSupersessionChildCommitment({
      contributionId: CONTRIBUTION_A,
      snapshot: snapshot(),
      edges: [edge('ä'), edge('Z')],
    });
    const expectedProjection = [
      'kavi.memory-fact-contribution.supersession-children.v1',
      1,
      CONTRIBUTION_A,
      [
        [CONTRIBUTION_A, 'successor-1', 1_700_000_000_000, 1, 0, 1, 1, 'verified', 'personal', 3],
        [CONTRIBUTION_A, 'Z', 'successor-1', 1_700_000_000_000],
        [CONTRIBUTION_A, 'ä', 'successor-1', 1_700_000_000_000],
      ],
    ];

    expect(actual).toEqual({
      version: 1,
      count: 3,
      sha256: sha256HexUtf8(JSON.stringify(expectedProjection)),
    });
  });

  it('domain-separates source and supersession projections', () => {
    const source = buildFactContributionSourceChildCommitment({
      contributionId: CONTRIBUTION_A,
      scope: SCOPE,
      sourceAliases: [{ sourceKind: 'message', sourceId: 'message-1' }],
    });
    const supersession = buildFactContributionSupersessionChildCommitment({
      contributionId: CONTRIBUTION_A,
      snapshot: snapshot(),
      edges: [edge('message-1')],
    });

    expect(source.sha256).not.toBe(supersession.sha256);
  });

  it('binds both child-set commitments to the contribution ID', () => {
    const sourceInput = {
      scope: SCOPE,
      sourceAliases: [{ sourceKind: 'message' as const, sourceId: 'message-1' }],
    };

    expect(
      buildFactContributionSourceChildCommitment({
        contributionId: CONTRIBUTION_A,
        ...sourceInput,
      }).sha256,
    ).not.toBe(
      buildFactContributionSourceChildCommitment({
        contributionId: CONTRIBUTION_B,
        ...sourceInput,
      }).sha256,
    );
    expect(
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: null,
        edges: [],
      }).sha256,
    ).not.toBe(
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_B,
        snapshot: null,
        edges: [],
      }).sha256,
    );
  });

  it('has a stable canonical commitment for the empty supersession child set', () => {
    expect(
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: null,
        edges: [],
      }),
    ).toEqual({
      version: 1,
      count: 0,
      sha256: '4b472994f2bc364a835c0311c38d8a9e6864d9233aa126886cb0eb640307e6f2',
    });
  });

  it('changes the digest when one persisted snapshot or edge field changes', () => {
    const baseline = buildFactContributionSupersessionChildCommitment({
      contributionId: CONTRIBUTION_A,
      snapshot: snapshot(),
      edges: [edge('predecessor-1')],
    });
    const changedSnapshotField = buildFactContributionSupersessionChildCommitment({
      contributionId: CONTRIBUTION_A,
      snapshot: snapshot({ successor_pinned_baseline: 0 }),
      edges: [edge('predecessor-1')],
    });
    const changedEdgeField = buildFactContributionSupersessionChildCommitment({
      contributionId: CONTRIBUTION_A,
      snapshot: snapshot(),
      edges: [edge('predecessor-2')],
    });

    expect(changedSnapshotField.sha256).not.toBe(baseline.sha256);
    expect(changedEdgeField.sha256).not.toBe(baseline.sha256);
  });

  it('rejects non-normalized aliases and incomplete supersession shapes', () => {
    expect(() =>
      buildFactContributionSourceChildCommitment({
        contributionId: CONTRIBUTION_A,
        scope: SCOPE,
        sourceAliases: [
          { sourceKind: 'message', sourceId: 'message-1' },
          { sourceKind: 'message', sourceId: 'message-1' },
        ],
      }),
    ).toThrow('memory_fact_contribution_child_commitment_source_aliases_invalid');
    expect(() =>
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: snapshot(),
        edges: [],
      }),
    ).toThrow('memory_fact_contribution_child_commitment_supersession_shape_invalid');
    expect(() =>
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: null,
        edges: [edge('predecessor-1')],
      }),
    ).toThrow('memory_fact_contribution_child_commitment_supersession_shape_invalid');
  });

  it('rejects extra row fields and child rows bound to another contribution', () => {
    expect(() =>
      buildFactContributionSourceChildCommitment({
        contributionId: CONTRIBUTION_A,
        scope: SCOPE,
        sourceAliases: [{ sourceKind: 'message', sourceId: 'message-1', extra: true }] as never,
      }),
    ).toThrow('memory_fact_contribution_child_commitment_source_aliases_invalid');
    expect(() =>
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: snapshot({ contribution_id: CONTRIBUTION_B }),
        edges: [edge('predecessor-1')],
      }),
    ).toThrow('memory_fact_contribution_child_commitment_supersession_snapshot_invalid');
  });

  it('rejects supersession child sets beyond the sealed 257-row limit', () => {
    expect(() =>
      buildFactContributionSupersessionChildCommitment({
        contributionId: CONTRIBUTION_A,
        snapshot: snapshot(),
        edges: Array.from({ length: 257 }, (_, index) => edge(`predecessor-${index}`)),
      }),
    ).toThrow('memory_fact_contribution_child_commitment_supersession_edges_invalid');
  });
});
