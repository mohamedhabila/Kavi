jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  buildEpisodeSourceIdentityManifest,
  buildMigratedEpisodeSourceIdentityManifest,
  decodeEpisodeSourceIdentityManifest,
  encodeEpisodeSourceIdentityManifest,
} from '../../../src/services/memory/episodes/sourceIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('episode source identity manifest', () => {
  it('retains exact user-message and assistant-turn kinds without treating tool IDs as messages', () => {
    const manifest = buildEpisodeSourceIdentityManifest([
      { id: 'source-user', role: 'user', content: 'request' },
      { id: 'source-assistant-plan', role: 'assistant', content: 'tool call' },
      { id: 'source-tool', role: 'tool', content: 'result' },
      { id: 'source-assistant-final', role: 'assistant', content: 'done' },
    ]);

    expect(manifest.sources).toEqual([
      { sourceKind: 'message', sourceId: 'source-user' },
      { sourceKind: 'turn', sourceId: 'source-assistant-plan' },
      { sourceKind: 'turn', sourceId: 'source-assistant-final' },
    ]);
    expect(
      decodeEpisodeSourceIdentityManifest(encodeEpisodeSourceIdentityManifest(manifest)),
    ).toEqual(manifest);
  });

  it('keeps one literal ID distinct when migration knows it under two source kinds', () => {
    expect(
      buildMigratedEpisodeSourceIdentityManifest({
        sourceStartMessageId: 'shared-source-id',
        sourceEndMessageId: 'shared-source-id',
      }).sources,
    ).toEqual([
      { sourceKind: 'message', sourceId: 'shared-source-id' },
      { sourceKind: 'turn', sourceId: 'shared-source-id' },
    ]);
  });

  it('rejects duplicate, malformed, or open source manifests', () => {
    expect(() =>
      buildEpisodeSourceIdentityManifest([
        { id: 'duplicate-source', role: 'user', content: 'one' },
        { id: 'duplicate-source', role: 'user', content: 'two' },
        { id: 'assistant-source', role: 'assistant', content: 'done' },
      ]),
    ).toThrow('episode_source_identity_invalid');
    expect(
      decodeEpisodeSourceIdentityManifest(
        JSON.stringify({
          version: 1,
          sources: [{ sourceKind: 'message', sourceId: 'source-user', extra: true }],
        }),
      ),
    ).toBeNull();
  });

  it('migrates an existing boundary-only row into the typed manifest once', () => {
    getMemoryDb().runSync(
      `INSERT INTO memory_episodes(
         id, started_at, ended_at, summary, sensitivity, source_start_message_id,
         source_end_message_id, source_identity_manifest_json, created_at
       ) VALUES (?, 1, 2, 'legacy episode', 'normal', ?, ?, ?, 3)`,
      'legacy-episode',
      'legacy-user-message',
      'legacy-assistant-turn',
      JSON.stringify({ version: 1, sources: [] }),
    );

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    const raw = getMemoryDb().getFirstSync<{ source_identity_manifest_json: string }>(
      'SELECT source_identity_manifest_json FROM memory_episodes WHERE id = ?',
      'legacy-episode',
    )?.source_identity_manifest_json;
    expect(raw && decodeEpisodeSourceIdentityManifest(raw)?.sources).toEqual([
      { sourceKind: 'message', sourceId: 'legacy-user-message' },
      { sourceKind: 'turn', sourceId: 'legacy-assistant-turn' },
    ]);
  });
});
