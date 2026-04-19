import {
  buildAutomaticPythonEvidenceEntries,
  buildAutomaticSubAgentEvidenceEntries,
} from '../../src/services/agents/automaticEvidence';
import type { SubAgentSnapshot } from '../../src/types';

function makeWorker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'worker-1',
    parentConversationId: 'conv-1',
    agentRunId: 'run-1',
    depth: 0,
    startedAt: 10,
    updatedAt: 20,
    status: 'completed',
    sandboxPolicy: 'inherit',
    output: 'Verified implementation details.',
    toolsUsed: ['read_file', 'python'],
    artifacts: [
      {
        id: 'attachment-1',
        type: 'file',
        uri: 'file:///mock/documents/workspace/conv-1/reports/result.txt',
        name: 'result.txt',
        mimeType: 'text/plain',
        size: 4,
        workspacePath: 'reports/result.txt',
      },
    ],
    ...overrides,
  };
}

describe('automatic workflow evidence helpers', () => {
  it('creates worker summary and artifact evidence on completion', () => {
    const entries = buildAutomaticSubAgentEvidenceEntries(makeWorker(), 'completed');

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'summary',
          status: 'verified',
          recorder: 'worker',
          title: 'Worker completed: worker-1',
          workerSessionId: 'worker-1',
        }),
        expect.objectContaining({
          kind: 'artifact',
          status: 'verified',
          recorder: 'worker',
          artifactWorkspacePath: 'reports/result.txt',
          workerSessionId: 'worker-1',
        }),
      ]),
    );
  });

  it('creates an open risk entry for failed workers', () => {
    const entries = buildAutomaticSubAgentEvidenceEntries(
      makeWorker({
        status: 'error',
        output: 'pytest failed with a schema mismatch.',
        artifacts: undefined,
      }),
      'error',
    );

    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'risk',
        status: 'open',
        recorder: 'worker',
        title: 'Worker failed: worker-1',
        content: expect.stringContaining('pytest failed with a schema mismatch.'),
      }),
    ]);
  });

  it('creates Python summary and artifact evidence entries', () => {
    const entries = buildAutomaticPythonEvidenceEntries({
      success: true,
      output: 'analysis complete',
      files: [{ path: 'reports/analysis.json' }],
      emittedEvidenceCount: 2,
      workerSessionId: 'worker-1',
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'summary',
          status: 'verified',
          recorder: 'python',
          title: 'Python execution completed',
          workerSessionId: 'worker-1',
        }),
        expect.objectContaining({
          kind: 'artifact',
          status: 'verified',
          recorder: 'python',
          artifactWorkspacePath: 'reports/analysis.json',
          workerSessionId: 'worker-1',
        }),
      ]),
    );
  });
});
