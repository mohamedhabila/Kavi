jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  findEntityByName,
  getEntitiesByIds,
  getEntityById,
  softDeleteEntity,
  upsertEntity,
} from '../../../src/services/memory/entities';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

describe('upsertEntity', () => {
  it('creates a new entity with normalized name', () => {
    const entity = upsertEntity({ name: '  Mohamed  ', type: 'person' });
    expect(entity.canonicalName).toBe('mohamed');
    expect(entity.type).toBe('person');
    expect(entity.aliases).toEqual([]);
    expect(entity.deletedAt).toBeNull();
  });

  it('returns existing entity on canonical match and rolls up aliases + attributes', () => {
    const first = upsertEntity({
      name: 'Acme Corp',
      type: 'org',
      aliases: ['acme'],
      attributes: { city: 'Seattle' },
    });
    const second = upsertEntity({
      name: 'Acme Corp',
      type: 'org',
      aliases: ['ACME inc'],
      attributes: { tier: 'gold' },
    });
    expect(second.id).toBe(first.id);
    expect(second.aliases).toEqual(expect.arrayContaining(['acme', 'acme inc']));
    expect(second.attributes).toMatchObject({ city: 'Seattle', tier: 'gold' });
  });

  it('finds an existing entity via alias match', () => {
    const created = upsertEntity({ name: 'Kavi', type: 'project', aliases: ['kavi mobile'] });
    const looked = upsertEntity({ name: 'Kavi Mobile', type: 'project' });
    expect(looked.id).toBe(created.id);
  });

  it('throws on empty name', () => {
    expect(() => upsertEntity({ name: '   ', type: 'person' })).toThrow(/required/);
  });

  it('soft-deletes and is then invisible to default lookups', () => {
    const entity = upsertEntity({ name: 'Bob', type: 'person' });
    expect(softDeleteEntity(entity.id)).toBe(true);
    expect(findEntityByName('Bob', 'person')).toBeNull();
    expect(getEntityById(entity.id)?.deletedAt).not.toBeNull();
  });

  it('resolves every requested current entity across bounded SQL batches', () => {
    const entities = Array.from({ length: 520 }, (_, index) =>
      upsertEntity({ name: `batch entity ${index}`, type: 'thing' }),
    );

    const resolved = getEntitiesByIds([
      ...entities.map((entity) => entity.id).reverse(),
      entities[0].id,
      ' ',
      'missing-entity',
    ]);

    expect(resolved).toHaveLength(entities.length);
    expect(new Set(resolved.map((entity) => entity.id))).toEqual(
      new Set(entities.map((entity) => entity.id)),
    );
    expect(resolved.map((entity) => entity.id)).toEqual(
      [...resolved.map((entity) => entity.id)].sort(),
    );
  });
});
