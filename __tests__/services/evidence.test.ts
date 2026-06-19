import {
  buildAgentRunEvidencePromptSection,
  filterAgentRunEvidenceEntries,
  normalizeAgentRunEvidenceEntries,
  upsertAgentRunEvidenceEntries,
} from '../../src/services/agents/lifecycle/evidence';

describe('workflow evidence utilities', () => {
  it('normalizes, upserts by dedupe key, and preserves createdAt', () => {
    const initial = normalizeAgentRunEvidenceEntries([
      {
        kind: 'fact',
        status: 'candidate',
        recorder: 'supervisor',
        title: 'Repository scan',
        content: 'Found 12 relevant files.',
        dedupeKey: 'repo-scan',
        createdAt: 10,
        updatedAt: 10,
      },
    ]);

    const updated = upsertAgentRunEvidenceEntries(
      initial,
      [
        {
          kind: 'fact',
          status: 'verified',
          recorder: 'supervisor',
          title: 'Repository scan',
          content: 'Confirmed 12 relevant files.',
          dedupeKey: 'repo-scan',
          updatedAt: 20,
        },
      ],
      20,
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual(
      expect.objectContaining({
        status: 'verified',
        content: 'Confirmed 12 relevant files.',
        dedupeKey: 'repo-scan',
        createdAt: 10,
        updatedAt: 20,
      }),
    );
  });

  it('filters by status and query and builds prompt-friendly output', () => {
    const entries = normalizeAgentRunEvidenceEntries([
      {
        kind: 'artifact',
        status: 'verified',
        recorder: 'worker',
        title: 'Patched file',
        content: 'Updated src/store/useChatStore.ts',
        artifactWorkspacePath: 'src/store/useChatStore.ts',
        createdAt: 10,
        updatedAt: 10,
      },
      {
        kind: 'question',
        status: 'open',
        recorder: 'supervisor',
        title: 'Need persistence coverage',
        content: 'Add a persistence test for evidence trimming.',
        createdAt: 20,
        updatedAt: 20,
      },
    ]);

    const filtered = filterAgentRunEvidenceEntries(entries, {
      statuses: ['verified'],
      query: 'patched',
    });
    const section = buildAgentRunEvidencePromptSection(filtered, {
      heading: 'Structured workflow evidence:',
      includeContent: true,
    });

    expect(filtered).toHaveLength(1);
    expect(section).toContain('Structured workflow evidence:');
    expect(section).toContain('[verified artifact] Patched file');
    expect(section).toContain('artifact=src/store/useChatStore.ts');
  });
});
