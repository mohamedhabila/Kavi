import { executeReadFile } from '../../src/engine/tools/toolWorkspaceCoreExecution';
import { readWorkspaceSourceTextFile } from '../../src/services/workspaces/sourceFiles';
import {
  completedToolOutcome,
  resolveExactToolResultEvidence,
} from '../../src/types/toolRuntimeOutcome';
import { sha256HexUtf8 } from '../../src/utils/sha256';

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

  it('leaves ordinary completed outcomes ineligible', () => {
    const outcome = completedToolOutcome('unattested');

    expect(resolveExactToolResultEvidence(outcome, outcome.content)).toBeUndefined();
  });
});
