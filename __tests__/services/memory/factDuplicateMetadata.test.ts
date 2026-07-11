jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  mergeDuplicateProvenance,
  mergeDuplicateReviewState,
  mergeDuplicateSensitivity,
} from '../../../src/services/memory/facts/duplicateMetadata';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('duplicate fact metadata transitions', () => {
  it.each([
    ['verified', 'auto', 'verified'],
    ['pending_review', 'verified', 'pending_review'],
    ['verified', 'pending_review', 'pending_review'],
    ['pending_review', 'stale', 'stale'],
    ['stale', 'conflicted', 'conflicted'],
    ['rejected', 'verified', 'rejected'],
    ['auto', 'verified', 'verified'],
  ] as const)(
    'merges review state %s + %s without weakening protection',
    (existing, incoming, expected) => {
      expect(mergeDuplicateReviewState(existing, incoming)).toBe(expected);
    },
  );

  it.each([
    ['normal', 'personal', 'personal'],
    ['personal', 'normal', 'personal'],
    ['personal', 'sensitive', 'sensitive'],
    ['restricted', 'normal', 'restricted'],
    ['sensitive', 'restricted', 'restricted'],
  ] as const)('merges sensitivity %s + %s monotonically', (existing, incoming, expected) => {
    expect(mergeDuplicateSensitivity(existing, incoming)).toBe(expected);
  });

  it.each([
    {
      name: 'rejects a lower-authority relabel',
      existingFactClass: 'subjective_user',
      existingSourceAuthority: 'grounded_user',
      incomingFactClass: 'workflow',
      incomingSourceAuthority: 'assistant_inferred',
      incomingIsSealed: true,
      expectedFactClass: 'subjective_user',
      expectedSourceAuthority: 'grounded_user',
    },
    {
      name: 'accepts a sealed grounded upgrade',
      existingFactClass: 'workflow',
      existingSourceAuthority: 'assistant_inferred',
      incomingFactClass: 'subjective_user',
      incomingSourceAuthority: 'grounded_user',
      incomingIsSealed: true,
      expectedFactClass: 'subjective_user',
      expectedSourceAuthority: 'grounded_user',
    },
    {
      name: 'keeps peer grounded authorities in their original domain',
      existingFactClass: 'objective',
      existingSourceAuthority: 'external_source',
      incomingFactClass: 'workflow',
      incomingSourceAuthority: 'tool_observed',
      incomingIsSealed: true,
      expectedFactClass: 'objective',
      expectedSourceAuthority: 'external_source',
    },
    {
      name: 'rejects an unsealed provenance upgrade',
      existingFactClass: 'workflow',
      existingSourceAuthority: 'assistant_inferred',
      incomingFactClass: 'subjective_user',
      incomingSourceAuthority: 'grounded_user',
      incomingIsSealed: false,
      expectedFactClass: 'workflow',
      expectedSourceAuthority: 'assistant_inferred',
    },
  ] as const)('$name', (fixture) => {
    expect(
      mergeDuplicateProvenance({
        existingFactClass: fixture.existingFactClass,
        existingSourceAuthority: fixture.existingSourceAuthority,
        incoming: {
          factClass: fixture.incomingFactClass,
          sourceAuthority: fixture.incomingSourceAuthority,
          personaId: null,
        },
        incomingIsSealed: fixture.incomingIsSealed,
      }),
    ).toEqual({
      factClass: fixture.expectedFactClass,
      sourceAuthority: fixture.expectedSourceAuthority,
    });
  });

  it('preserves explicit review, stricter sensitivity, and stronger provenance on duplicate writes', () => {
    const first = recordFactWithApplicability(
      {
        subjectId: 'entity-user',
        predicate: 'preference',
        objectText: 'Concise answers',
        scope: 'global',
        reviewState: 'verified',
        sensitivity: 'sensitive',
        sourceMessageId: 'message-1',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );

    const duplicate = recordFactWithApplicability(
      {
        subjectId: 'entity-user',
        predicate: 'preference',
        objectText: 'Concise answers',
        scope: 'global',
        reviewState: 'auto',
        sensitivity: 'normal',
        sourceMessageId: 'message-2',
        now: 200,
      },
      { factClass: 'workflow', sourceAuthority: 'assistant_inferred' },
    );

    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.fact.id).toBe(first.fact.id);
    expect(duplicate.fact).toMatchObject({
      reviewState: 'verified',
      sensitivity: 'sensitive',
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
    });
  });

  it('upgrades inferred provenance on a code-owned grounded replay without counting it twice', () => {
    const input = {
      subjectId: 'entity-user',
      predicate: 'timezone',
      objectText: 'Europe/Amsterdam',
      scope: 'global' as const,
      sourceMessageId: 'message-grounding-source',
    };
    const inferred = recordFactWithApplicability(
      { ...input, now: 100 },
      { factClass: 'workflow', sourceAuthority: 'assistant_inferred' },
    );

    const grounded = recordFactWithApplicability(
      { ...input, now: 200 },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );

    expect(grounded.status).toBe('duplicate');
    expect(grounded.fact.id).toBe(inferred.fact.id);
    expect(grounded.fact).toMatchObject({
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      repeatedMentionCount: 0,
    });
  });

  it('allows duplicate ingestion to add caution but never remove it', () => {
    const base = {
      subjectId: 'entity-user',
      predicate: 'reviewed_preference',
      objectText: 'Use compact summaries',
      scope: 'global' as const,
    };
    recordFactWithApplicability(
      { ...base, reviewState: 'verified', sensitivity: 'normal', now: 100 },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
    const cautious = recordFactWithApplicability(
      { ...base, reviewState: 'pending_review', sensitivity: 'restricted', now: 200 },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
    const attemptedRelaxation = recordFactWithApplicability(
      { ...base, reviewState: 'verified', sensitivity: 'normal', now: 300 },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );

    expect(cautious.fact).toMatchObject({
      reviewState: 'pending_review',
      sensitivity: 'restricted',
    });
    expect(attemptedRelaxation.fact).toMatchObject({
      reviewState: 'pending_review',
      sensitivity: 'restricted',
    });
  });
});
