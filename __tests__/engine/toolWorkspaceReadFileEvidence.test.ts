import { executeReadFile } from '../../src/engine/tools/toolWorkspaceCoreExecution';
import { readWorkspaceSourceTextFile } from '../../src/services/workspaces/sourceFiles';
import {
  completedToolOutcome,
  resolveExactToolResultEvidence,
} from '../../src/types/toolRuntimeOutcome';
import { sha256HexUtf8 } from '../../src/utils/sha256';
import { TOOL_OUTPUT_SPILL_CHAR_THRESHOLD } from '../../src/engine/tools/toolOutputSpill';

jest.mock('../../src/services/workspaces/source', () => ({
  resolveConversationWorkspaceSource: jest.fn(() => ({
    kind: 'conversation',
    conversationId: 'conversation-1',
  })),
}));

jest.mock('../../src/services/workspaces/sourceFiles', () => ({
  readWorkspaceSourceTextFile: jest.fn(),
  listWorkspaceSourceDirectory: jest.fn(),
  writeWorkspaceSourceTextFile: jest.fn(),
  workspaceSourceDirectoryExists: jest.fn(),
}));

const mockedReadWorkspaceSourceTextFile = jest.mocked(readWorkspaceSourceTextFile);

describe('read_file exact-result evidence', () => {
  beforeEach(() => {
    mockedReadWorkspaceSourceTextFile.mockReset();
  });

  it('attests the exact successful workspace read without serializing authority', async () => {
    const content = 'الاسم: نور 🌍';
    mockedReadWorkspaceSourceTextFile.mockResolvedValueOnce({
      path: 'profile.txt',
      content,
      size: content.length,
    });

    const outcome = await executeReadFile({ path: 'profile.txt' }, 'conversation-1');

    expect(outcome).toEqual({ status: 'completed', content });
    expect(Object.keys(outcome)).toEqual(['status', 'content']);
    expect(resolveExactToolResultEvidence(outcome, content)).toEqual({
      resultSha256: sha256HexUtf8(content),
      resultByteLength: new TextEncoder().encode(content).byteLength,
    });
  });

  it('rejects modified bytes and a structurally identical cloned outcome', async () => {
    const content = 'exact source';
    mockedReadWorkspaceSourceTextFile.mockResolvedValueOnce({
      path: 'profile.txt',
      content,
      size: content.length,
    });
    const outcome = await executeReadFile({ path: 'profile.txt' }, 'conversation-1');

    expect(resolveExactToolResultEvidence(outcome, `${content}!`)).toBeUndefined();
    expect(resolveExactToolResultEvidence({ ...outcome }, content)).toBeUndefined();
  });

  // Traced on Sonnet 5.5 (Claw-Anything): a week of the person's activity log (about 30 KB)
  // came back in 7.5 KB chunks, and the model answered from the first.
  it('returns a 30 KB log whole', async () => {
    const content = 'activity row\n'.repeat(2_400);
    mockedReadWorkspaceSourceTextFile.mockResolvedValue({
      path: 'logs/week.md',
      content,
      size: content.length,
    });

    const outcome = await executeReadFile(
      { path: 'logs/week.md' },
      'conversation-1',
      undefined,
      400_000,
    );

    expect(outcome).toMatchObject({ status: 'completed', content });
  });

  it('reads in smaller chunks for a model whose window holds less', async () => {
    const content = 'activity row\n'.repeat(2_400);
    mockedReadWorkspaceSourceTextFile.mockResolvedValue({
      path: 'logs/week.md',
      content,
      size: content.length,
    });

    const outcome = await executeReadFile(
      { path: 'logs/week.md' },
      'conversation-1',
      undefined,
      8_192,
    );

    expect(outcome.status).toBe('completed');
    expect(outcome.content.length).toBeLessThanOrEqual(4_096);
    expect(JSON.parse(outcome.content)).toMatchObject({ status: 'read_chunk', complete: false });
  });

  it('returns bounded chunks that reconstruct a large file from the original path', async () => {
    const content = `${'quote: \\" and emoji 🌍\n'.repeat(2_600)}final line`;
    mockedReadWorkspaceSourceTextFile.mockResolvedValue({
      path: 'large.txt',
      content,
      size: content.length,
    });

    let offset: number | undefined;
    let reconstructed = '';
    let readCount = 0;
    const expectedSha256 = sha256HexUtf8(content);
    do {
      const outcome = await executeReadFile(
        offset === undefined ? { path: 'large.txt' } : { path: 'large.txt', offset },
        'conversation-1',
      );
      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') throw new Error(outcome.content);
      expect(outcome.content.length).toBeLessThan(TOOL_OUTPUT_SPILL_CHAR_THRESHOLD);
      const chunk = JSON.parse(outcome.content) as {
        status: string;
        path: string;
        sha256: string;
        content: string;
        offset: number;
        nextOffset: number | null;
        complete: boolean;
        guidance: string;
      };
      expect(chunk.status).toBe('read_chunk');
      expect(chunk.path).toBe('large.txt');
      expect(chunk.sha256).toBe(expectedSha256);
      expect(chunk.offset).toBe(offset ?? 0);
      expect(chunk.guidance).not.toContain('.kavi/spill/');
      reconstructed += chunk.content;
      offset = chunk.nextOffset ?? undefined;
      readCount += 1;
      if (readCount > 100) throw new Error('read_file chunks did not terminate');
      if (chunk.complete) break;
    } while (offset !== undefined);

    expect(readCount).toBeGreaterThan(1);
    expect(reconstructed).toBe(content);
    expect(mockedReadWorkspaceSourceTextFile).toHaveBeenCalledTimes(readCount);
  });

  it('rejects invalid or out-of-range continuation offsets without guessing', async () => {
    mockedReadWorkspaceSourceTextFile.mockResolvedValue({
      path: 'profile.txt',
      content: 'hello',
      size: 5,
    });

    await expect(
      executeReadFile({ path: 'profile.txt', offset: -1 }, 'conversation-1'),
    ).resolves.toMatchObject({
      status: 'failed',
      content: expect.stringContaining('non-negative'),
    });
    await expect(
      executeReadFile({ path: 'profile.txt', offset: 6 }, 'conversation-1'),
    ).resolves.toMatchObject({ status: 'failed', content: expect.stringContaining('exceeds') });
  });

  it('leaves ordinary completed outcomes ineligible', () => {
    const outcome = completedToolOutcome('unattested');

    expect(resolveExactToolResultEvidence(outcome, outcome.content)).toBeUndefined();
  });
});
