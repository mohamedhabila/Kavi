import {
  shareConversationWorkspaceFile,
  shareLocalFile,
  shareTextExport,
} from '../../../src/services/share/localShare';

const mockShareAsync = jest.fn().mockResolvedValue(undefined);
const mockIsAvailableAsync = jest.fn().mockResolvedValue(true);
const mockDirectoryCreate = jest.fn().mockResolvedValue(undefined);
const mockFileWrite = jest.fn();
const mockInspectConversationWorkspaceFile = jest.fn();

function mockNormalizePathPart(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/^file:\/\//, '').replace(/^\/+/, '');
  }

  if (
    value &&
    typeof value === 'object' &&
    'uri' in value &&
    typeof (value as { uri?: unknown }).uri === 'string'
  ) {
    return (value as { uri: string }).uri.replace(/^file:\/\//, '').replace(/^\/+/, '');
  }

  return String(value);
}

function mockBuildUri(parts: unknown[]): string {
  return `file:///${parts.map(mockNormalizePathPart).join('/')}`;
}

jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
}));

jest.mock('expo-file-system', () => ({
  Directory: jest.fn().mockImplementation((...parts: unknown[]) => ({
    uri: mockBuildUri(parts),
    create: (...args: unknown[]) => mockDirectoryCreate(...args),
  })),
  File: jest.fn().mockImplementation((...parts: unknown[]) => ({
    uri: mockBuildUri(parts),
    write: (...args: unknown[]) => mockFileWrite(...args),
  })),
  Paths: { cache: '/cache', document: '/documents' },
}));

jest.mock('../../../src/services/conversationWorkspace/files', () => ({
  inspectConversationWorkspaceFile: (...args: unknown[]) =>
    mockInspectConversationWorkspaceFile(...args),
}));

describe('localShare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('writes text exports to cache and shares the sanitized file', async () => {
    const result = await shareTextExport({
      content: '# Hello',
      fileName: 'Résumé Export.MD',
      dialogTitle: 'Share response',
    });

    expect(mockDirectoryCreate).toHaveBeenCalledWith({ idempotent: true, intermediates: true });
    expect(mockFileWrite).toHaveBeenCalledWith('# Hello');
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///cache/share-exports/Resume-Export.md',
      expect.objectContaining({
        dialogTitle: 'Share response',
        mimeType: 'text/markdown',
        UTI: 'net.daringfireball.markdown',
      }),
    );
    expect(result).toEqual({
      fileName: 'Resume-Export.md',
      fileUri: 'file:///cache/share-exports/Resume-Export.md',
    });
  });

  it('shares inspected workspace files with inferred markdown metadata', async () => {
    mockInspectConversationWorkspaceFile.mockResolvedValue({
      conversationId: 'conv-fallback',
      path: 'notes/report.md',
      uri: 'file:///documents/workspace/conv-fallback/notes/report.md',
    });

    const result = await shareConversationWorkspaceFile({
      conversationId: 'conv-primary',
      path: 'notes/report.md',
      fallbackConversationIds: ['conv-fallback'],
      dialogTitle: 'report.md',
    });

    expect(mockInspectConversationWorkspaceFile).toHaveBeenCalledWith(
      'conv-primary',
      'notes/report.md',
      ['conv-fallback'],
    );
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///documents/workspace/conv-fallback/notes/report.md',
      expect.objectContaining({
        dialogTitle: 'report.md',
        mimeType: 'text/markdown',
        UTI: 'net.daringfireball.markdown',
      }),
    );
    expect(result).toEqual({
      conversationId: 'conv-fallback',
      path: 'notes/report.md',
      fileUri: 'file:///documents/workspace/conv-fallback/notes/report.md',
    });
  });

  it('throws when sharing is unavailable', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(shareLocalFile({ fileUri: 'file:///tmp/test.txt' })).rejects.toThrow(
      'Sharing is unavailable on this device.',
    );
    expect(mockShareAsync).not.toHaveBeenCalled();
  });
});
