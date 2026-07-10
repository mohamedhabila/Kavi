import type { EntityType } from '../services/memory/entities';

export const MEMORY_HYBRID_ABLATION_FIXTURE_VERSION = 'memory-hybrid-ablation-v1' as const;
export const MEMORY_HYBRID_ABLATION_FIXTURE_SIGNATURE =
  'sha256:759fe1b05e0bdc255f5dc640a7c55f9a2dfd7d5bc104b82f60dfe16314a942e3' as const;

export type MemoryHybridAblationFamily =
  | 'lexical_control'
  | 'entity'
  | 'temporal'
  | 'local_semantic'
  | 'eligibility_negative';

export type MemoryHybridAblationPath = 'foreground_prompt_visible' | 'component_only';

export type MemoryHybridAblationEntitySeed = Readonly<{
  key: string;
  name: string;
  type: EntityType;
  aliases?: ReadonlyArray<string>;
}>;

export type MemoryHybridAblationFactSeed = Readonly<{
  key: string;
  entityKey: string;
  predicate: string;
  objectText: string;
  now: number;
  validAt?: number;
  expiresAt?: number;
  embedding?: ReadonlyArray<number>;
  origin: 'active' | 'other';
  deleted?: boolean;
}>;

export type MemoryHybridAblationCase = Readonly<{
  id: string;
  family: MemoryHybridAblationFamily;
  path: MemoryHybridAblationPath;
  query: string;
  now: number;
  expectedFactKey: string | null;
  entities: ReadonlyArray<MemoryHybridAblationEntitySeed>;
  facts: ReadonlyArray<MemoryHybridAblationFactSeed>;
  generatedDistractors?: Readonly<{
    count: number;
    entityKey: string;
    predicate: string;
    objectPrefix: string;
    startAt: number;
  }>;
  queryEmbedding?: ReadonlyArray<number>;
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

const IN_2021 = Date.UTC(2021, 0, 15);

export const MEMORY_HYBRID_ABLATION_CASES: ReadonlyArray<MemoryHybridAblationCase> = deepFreeze([
  {
    id: 'lexical-parity-editor',
    family: 'lexical_control',
    path: 'foreground_prompt_visible',
    query: 'Which editor preference uses Neovim with Lua?',
    now: 1_000,
    expectedFactKey: 'target',
    entities: [{ key: 'profile', name: 'Editor Profile', type: 'concept' }],
    facts: [
      {
        key: 'target',
        entityKey: 'profile',
        predicate: 'preferred_editor',
        objectText: 'Neovim with Lua',
        now: 100,
        origin: 'active',
      },
      {
        key: 'distractor',
        entityKey: 'profile',
        predicate: 'alternate_editor',
        objectText: 'JetBrains IDE',
        now: 200,
        origin: 'active',
      },
    ],
  },
  {
    id: 'entity-alias-prefix',
    family: 'entity',
    path: 'foreground_prompt_visible',
    query: 'Northern Lights deployment status',
    now: 2_000,
    expectedFactKey: 'target',
    entities: [
      {
        key: 'target-project',
        name: 'Project Aurora',
        type: 'project',
        aliases: ['Northern Lights'],
      },
      { key: 'other-project', name: 'Other Project', type: 'project' },
    ],
    facts: [
      {
        key: 'target',
        entityKey: 'target-project',
        predicate: 'deployment_status',
        objectText: 'green',
        now: 1,
        origin: 'active',
      },
    ],
    generatedDistractors: {
      count: 130,
      entityKey: 'other-project',
      predicate: 'deployment_status',
      objectPrefix: 'amber',
      startAt: 100,
    },
  },
  {
    id: 'explicit-year-temporal',
    family: 'temporal',
    path: 'foreground_prompt_visible',
    query: 'What happened in 2021?',
    now: Date.UTC(2021, 6, 1),
    expectedFactKey: 'target',
    entities: [{ key: 'timeline', name: 'Timeline Project', type: 'project' }],
    facts: [
      {
        key: 'target',
        entityKey: 'timeline',
        predicate: 'milestone_code',
        objectText: 'blue-phase',
        now: IN_2021,
        validAt: IN_2021,
        origin: 'active',
      },
      {
        key: 'distractor',
        entityKey: 'timeline',
        predicate: 'older_code',
        objectText: 'gray-phase',
        now: Date.UTC(2020, 0, 15),
        origin: 'active',
      },
    ],
  },
  {
    id: 'compatible-local-semantic',
    family: 'local_semantic',
    path: 'component_only',
    query: 'conceptually related memory',
    now: 1_000,
    expectedFactKey: 'target',
    entities: [{ key: 'semantic', name: 'Semantic Project', type: 'project' }],
    facts: [
      {
        key: 'target',
        entityKey: 'semantic',
        predicate: 'opaque_signal',
        objectText: 'violet-cipher',
        embedding: [1, 0],
        now: 100,
        origin: 'active',
      },
      {
        key: 'distractor',
        entityKey: 'semantic',
        predicate: 'other_signal',
        objectText: 'orange-cipher',
        embedding: [0, 1],
        now: 101,
        origin: 'active',
      },
    ],
    queryEmbedding: [1, 0],
  },
  {
    id: 'eligibility-negative',
    family: 'eligibility_negative',
    path: 'foreground_prompt_visible',
    query: 'FILTER-SENTINEL',
    now: 500,
    expectedFactKey: null,
    entities: [{ key: 'filter', name: 'Filter Subject', type: 'concept' }],
    facts: [
      {
        key: 'expired',
        entityKey: 'filter',
        predicate: 'expired_signal',
        objectText: 'FILTER-SENTINEL',
        expiresAt: 200,
        now: 100,
        origin: 'active',
      },
      {
        key: 'deleted',
        entityKey: 'filter',
        predicate: 'deleted_signal',
        objectText: 'FILTER-SENTINEL',
        deleted: true,
        now: 100,
        origin: 'active',
      },
      {
        key: 'other-scope',
        entityKey: 'filter',
        predicate: 'private_signal',
        objectText: 'FILTER-SENTINEL',
        now: 100,
        origin: 'other',
      },
    ],
  },
]);
