import {
  conversationWorkspaceDirectoryExists,
  inspectConversationWorkspaceFile,
  listConversationWorkspaceDirectory,
  readConversationWorkspaceTextFile,
  writeConversationWorkspaceBinaryFile,
  writeConversationWorkspaceTextFile,
} from '../../src/services/conversationWorkspace/files';
import { importConversationWorkspaceAttachment } from '../../src/services/conversationWorkspace/attachments';
import { getConversationWorkspaceFileUri } from '../../src/services/conversationWorkspace/storage';
import { normalizeConversationWorkspacePath } from '../../src/services/files/pathUtils';

type MockDirectoryEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
  modificationTime?: number;
};

const mockFileContentsByPath: Record<string, string | Uint8Array | Error> = {};
const mockDirectoryEntriesByPath: Record<string, MockDirectoryEntry[]> = {};
const mockCreatedDirectories: string[] = [];
const mockWrites: Array<{ path: string; content: string }> = [];
const mockBinaryWrites: Array<{ path: string; content: Uint8Array }> = [];
const mockLegacyWrites: Array<{ path: string; content: string }> = [];

const mockReadAttachmentBase64 = jest.fn();
const mockLegacyWriteAsStringAsync = jest.fn(async (uri: string, content: string) => {
  const path = mockNormalizeBasePath(uri);
  const normalized = content.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  mockLegacyWrites.push({ path, content });
  mockFileContentsByPath[path] = new Uint8Array(byteLength);
});

function mockNormalizeBasePath(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/^file:\/\//, '');
  }

  if (value && typeof value === 'object' && 'uri' in (value as Record<string, unknown>)) {
    const uri = (value as { uri?: unknown }).uri;
    if (typeof uri === 'string') {
      return uri.replace(/^file:\/\//, '');
    }
  }

  return '';
}

function mockJoinPath(...parts: unknown[]): string {
  const segments = parts
    .map((part) => mockNormalizeBasePath(part))
    .flatMap((part) => part.split('/'))
    .filter(Boolean);

  return `/${segments.join('/')}`;
}

function mockToFileUri(path: string): string {
  return `file://${path}`;
}

const mockFileExists = (path: string) =>
  Object.prototype.hasOwnProperty.call(mockFileContentsByPath, path);
const mockFileSize = (path: string) => {
  const content = mockFileContentsByPath[path];
  if (typeof content === 'string') {
    return content.length;
  }
  if (content instanceof Uint8Array) {
    return content.byteLength;
  }
  return undefined;
};
const mockFileText = jest.fn(async (path: string) => {
  const content = mockFileContentsByPath[path];
  if (content instanceof Error) {
    throw content;
  }
  if (content instanceof Uint8Array) {
    throw new Error('binary');
  }
  return typeof content === 'string' ? content : '(file not found)';
});
const mockFileBytes = jest.fn(async (path: string) => {
  const content = mockFileContentsByPath[path];
  if (content instanceof Error) {
    throw content;
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (typeof content === 'string') {
    return new Uint8Array(Buffer.from(content));
  }
  throw new Error('file not found');
});
const mockDirExists = (path: string) =>
  Object.prototype.hasOwnProperty.call(mockDirectoryEntriesByPath, path);

const mockDirList = jest.fn((path: string) => {
  const entriesByName = new Map<string, MockDirectoryEntry>();
  for (const entry of mockDirectoryEntriesByPath[path] || []) {
    entriesByName.set(entry.name, entry);
  }

  const prefix = `${path.replace(/\/+$/g, '')}/`;
  for (const filePath of Object.keys(mockFileContentsByPath)) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const rest = filePath.slice(prefix.length);
    if (!rest) {
      continue;
    }
    const firstPart = rest.split('/')[0]!;
    if (entriesByName.has(firstPart)) {
      continue;
    }
    entriesByName.set(firstPart, {
      name: firstPart,
      type: rest.includes('/') ? 'directory' : 'file',
      size: rest.includes('/') ? undefined : mockFileSize(filePath),
    });
  }

  return Array.from(entriesByName.values()).map((entry) => {
    const entryPath = mockJoinPath(path, entry.name);
    if (entry.type === 'directory') {
      return {
        name: entry.name,
        uri: mockToFileUri(entryPath),
        ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
        ...(typeof entry.modificationTime === 'number'
          ? { modificationTime: entry.modificationTime }
          : {}),
        list: () => mockDirList(entryPath),
        create: jest.fn(async () => {
          mockCreatedDirectories.push(entryPath);
          mockDirectoryEntriesByPath[entryPath] ||= [];
        }),
      };
    }

    return {
      name: entry.name,
      uri: mockToFileUri(entryPath),
      ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
      ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
      ...(typeof entry.modificationTime === 'number'
        ? { modificationTime: entry.modificationTime }
        : {}),
      text: () => mockFileText(entryPath),
      write: (content: string) => {
        mockWrites.push({ path: entryPath, content });
        mockFileContentsByPath[entryPath] = content;
      },
    };
  });
});

jest.mock('expo-file-system', () => ({
  Paths: { document: '/mock/document' },
  File: jest.fn().mockImplementation((...parts: unknown[]) => {
    const path = mockJoinPath(...parts);
    return {
      name: path.split('/').pop() || '',
      uri: mockToFileUri(path),
      get exists() {
        return mockFileExists(path);
      },
      get size() {
        return mockFileSize(path);
      },
      text: () => mockFileText(path),
      bytes: () => mockFileBytes(path),
      arrayBuffer: async () =>
        mockFileBytes(path).then((bytes) =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
      copy: (destination: unknown) => {
        const content = mockFileContentsByPath[path];
        if (!mockFileExists(path) || content instanceof Error) {
          throw new Error('copy failed');
        }
        const destinationPath = mockNormalizeBasePath(destination);
        mockFileContentsByPath[destinationPath] = content;
      },
      write: (content: string | Uint8Array) => {
        if (content instanceof Uint8Array) {
          mockBinaryWrites.push({ path, content });
          mockFileContentsByPath[path] = content;
          return;
        }

        mockWrites.push({ path, content });
        mockFileContentsByPath[path] = content;
      },
    };
  }),
  Directory: jest.fn().mockImplementation((...parts: unknown[]) => {
    const path = mockJoinPath(...parts);
    return {
      name: path.split('/').pop() || '',
      uri: mockToFileUri(path),
      get exists() {
        return mockDirExists(path);
      },
      list: () => mockDirList(path),
      create: jest.fn(async () => {
        mockCreatedDirectories.push(path);
        mockDirectoryEntriesByPath[path] ||= [];
      }),
    };
  }),
}));

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: (...args: any[]) => mockLegacyWriteAsStringAsync(...args),
}));

jest.mock('../../src/services/media/attachmentPayloads', () => ({
  readAttachmentBase64: (...args: any[]) => mockReadAttachmentBase64(...args),
}));

describe('conversation workspace file service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatedDirectories.length = 0;
    mockWrites.length = 0;
    mockBinaryWrites.length = 0;
    mockLegacyWrites.length = 0;
    mockReadAttachmentBase64.mockReset();
    mockReadAttachmentBase64.mockResolvedValue(null);
    Object.keys(mockFileContentsByPath).forEach((key) => {
      delete mockFileContentsByPath[key];
    });
    Object.keys(mockDirectoryEntriesByPath).forEach((key) => {
      delete mockDirectoryEntriesByPath[key];
    });

    mockDirectoryEntriesByPath['/mock/document/workspace/conv1'] = [
      { name: 'src', type: 'directory', modifiedAt: '2026-04-10T12:00:00.000Z' },
      { name: 'README.md', type: 'file', size: 8, modifiedAt: '2026-04-10T12:01:00.000Z' },
      { name: 'image.png', type: 'file', size: 42, modifiedAt: '2026-04-10T12:02:00.000Z' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/conv1/src'] = [
      { name: 'App.tsx', type: 'file', size: 12, modifiedAt: '2026-04-10T12:03:00.000Z' },
      { name: 'archive.bin', type: 'file', size: 128, modifiedAt: '2026-04-10T12:04:00.000Z' },
    ];

    mockFileContentsByPath['/mock/document/workspace/conv1/README.md'] = '# readme';
    mockFileContentsByPath['/mock/document/workspace/conv1/image.png'] = new Error('binary');
    mockFileContentsByPath['/mock/document/workspace/conv1/src/App.tsx'] = 'const app = 1;';
    mockFileContentsByPath['/mock/document/workspace/conv1/src/archive.bin'] = new Error('binary');

    mockDirectoryEntriesByPath['/mock/document/workspace/session-1'] = [
      { name: 'skills', type: 'directory', modifiedAt: '2026-04-10T12:05:00.000Z' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/session-1/skills'] = [
      { name: 'prompt-skill', type: 'directory', modifiedAt: '2026-04-10T12:06:00.000Z' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/session-1/skills/prompt-skill'] = [
      { name: 'SKILL.md', type: 'file', size: 18, modifiedAt: '2026-04-10T12:07:00.000Z' },
    ];
    mockFileContentsByPath['/mock/document/workspace/session-1/skills/prompt-skill/SKILL.md'] =
      'Always be helpful.';
  });

  it('normalizes and reads text files from the conversation workspace', async () => {
    expect(normalizeConversationWorkspacePath('/src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeConversationWorkspacePath('.')).toBe('');
    expect(normalizeConversationWorkspacePath('./src/App.tsx')).toBe('src/App.tsx');

    const result = await readConversationWorkspaceTextFile('conv1', '/src/App.tsx');

    expect(result).toEqual({
      conversationId: 'conv1',
      path: 'src/App.tsx',
      content: 'const app = 1;',
      size: 14,
      uri: 'file:///mock/document/workspace/conv1/src/App.tsx',
    });
  });

  it('lists and detects inferred directories from file-backed workspace entries', async () => {
    mockFileContentsByPath[
      '/mock/document/workspace/conv-inferred/inbox/untrusted_note.txt'
    ] = 'safe';

    expect(conversationWorkspaceDirectoryExists('conv-inferred', '.')).toBe(true);
    expect(conversationWorkspaceDirectoryExists('conv-inferred', './inbox')).toBe(true);

    await expect(listConversationWorkspaceDirectory('conv-inferred', '.')).resolves.toEqual({
      path: '',
      entries: [
        {
          name: 'inbox',
          isDirectory: true,
          size: undefined,
          modifiedAt: undefined,
        },
      ],
    });
    await expect(listConversationWorkspaceDirectory('conv-inferred', './inbox')).resolves.toEqual({
      path: 'inbox',
      entries: [
        {
          name: 'untrusted_note.txt',
          isDirectory: false,
          size: 4,
          modifiedAt: undefined,
        },
      ],
    });
  });

  it('classifies image and binary files without forcing text reads', async () => {
    await expect(inspectConversationWorkspaceFile('conv1', 'image.png')).resolves.toEqual({
      conversationId: 'conv1',
      kind: 'image',
      path: 'image.png',
      uri: 'file:///mock/document/workspace/conv1/image.png',
    });

    await expect(inspectConversationWorkspaceFile('conv1', 'src/archive.bin')).resolves.toEqual({
      conversationId: 'conv1',
      kind: 'binary',
      path: 'src/archive.bin',
      uri: 'file:///mock/document/workspace/conv1/src/archive.bin',
    });
  });

  it('merges entries from fallback workspaces and resolves fallback files against their source workspace', async () => {
    const rootResult = await listConversationWorkspaceDirectory('conv1', '', ['session-1']);

    expect(rootResult).toEqual({
      path: '',
      entries: [
        {
          name: 'skills',
          isDirectory: true,
          size: undefined,
          modifiedAt: '2026-04-10T12:05:00.000Z',
        },
        {
          name: 'src',
          isDirectory: true,
          size: undefined,
          modifiedAt: '2026-04-10T12:00:00.000Z',
        },
        {
          name: 'image.png',
          isDirectory: false,
          size: 42,
          modifiedAt: '2026-04-10T12:02:00.000Z',
        },
        {
          name: 'README.md',
          isDirectory: false,
          size: 8,
          modifiedAt: '2026-04-10T12:01:00.000Z',
        },
      ],
    });

    await expect(
      inspectConversationWorkspaceFile('conv1', 'skills/prompt-skill/SKILL.md', ['session-1']),
    ).resolves.toEqual({
      conversationId: 'session-1',
      kind: 'text',
      path: 'skills/prompt-skill/SKILL.md',
      uri: 'file:///mock/document/workspace/session-1/skills/prompt-skill/SKILL.md',
      content: 'Always be helpful.',
    });
  });

  it('lists directory entries and writes normalized files back into the workspace', async () => {
    const listResult = await listConversationWorkspaceDirectory('conv1', 'src');

    expect(listResult).toEqual({
      path: 'src',
      entries: [
        {
          name: 'App.tsx',
          isDirectory: false,
          size: 12,
          modifiedAt: '2026-04-10T12:03:00.000Z',
        },
        {
          name: 'archive.bin',
          isDirectory: false,
          size: 128,
          modifiedAt: '2026-04-10T12:04:00.000Z',
        },
      ],
    });

    const writeResult = await writeConversationWorkspaceTextFile(
      'conv1',
      '../notes/out.txt',
      'hello',
    );

    expect(writeResult).toEqual({
      path: 'notes/out.txt',
      size: 5,
      uri: 'file:///mock/document/workspace/conv1/notes/out.txt',
    });
    expect(mockCreatedDirectories).toEqual(
      expect.arrayContaining([
        '/mock/document/workspace/conv1',
        '/mock/document/workspace/conv1/notes',
      ]),
    );
    expect(mockWrites).toContainEqual({
      path: '/mock/document/workspace/conv1/notes/out.txt',
      content: 'hello',
    });
  });

  it('reads modificationTime metadata, returns file URIs, and validates write arguments', async () => {
    Object.keys(mockFileContentsByPath).forEach((key) => {
      if (key.startsWith('/mock/document/workspace/conv1/')) {
        delete mockFileContentsByPath[key];
      }
    });
    mockDirectoryEntriesByPath['/mock/document/workspace/conv1'] = [
      { name: 'timed.txt', type: 'file', size: 4, modificationTime: 1712923200000 },
    ];
    mockFileContentsByPath['/mock/document/workspace/conv1/timed.txt'] = 'tick';

    const listResult = await listConversationWorkspaceDirectory('conv1');

    expect(listResult).toEqual({
      path: '',
      entries: [
        {
          name: 'timed.txt',
          isDirectory: false,
          size: 4,
          modifiedAt: new Date(1712923200000).toISOString(),
        },
      ],
    });

    expect(getConversationWorkspaceFileUri('conv1', '/timed.txt')).toBe(
      'file:///mock/document/workspace/conv1/timed.txt',
    );

    await expect(
      writeConversationWorkspaceTextFile('conv1', 'notes/out.txt', 7 as any),
    ).rejects.toThrow('conversation workspace file content must be a string');
    expect(() => getConversationWorkspaceFileUri('', 'timed.txt')).toThrow(
      'conversationId is required',
    );
    expect(() => getConversationWorkspaceFileUri('conv1', '/')).toThrow(
      'conversation workspace path must not be empty',
    );
  });

  it('writes binary content and imports attachments into a stable workspace path', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const binaryWrite = await writeConversationWorkspaceBinaryFile(
      'conv1',
      'bin/report.bin',
      bytes,
    );

    expect(binaryWrite).toEqual({
      path: 'bin/report.bin',
      size: 4,
      uri: 'file:///mock/document/workspace/conv1/bin/report.bin',
    });
    expect(mockBinaryWrites).toContainEqual({
      path: '/mock/document/workspace/conv1/bin/report.bin',
      content: bytes,
    });

    const sourceBytes = new Uint8Array(2048);
    sourceBytes[0] = 99;
    mockFileContentsByPath['/mock/document/inbox/report.pdf'] = sourceBytes;

    const imported = await importConversationWorkspaceAttachment('conv1', {
      id: 'att-1',
      type: 'file',
      uri: 'file:///mock/document/inbox/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    } as any);

    expect(imported).toEqual({
      imported: true,
      attachment: expect.objectContaining({
        id: 'att-1',
        uri: 'file:///mock/document/workspace/conv1/attachments/files/att-1-report.pdf',
        workspacePath: 'attachments/files/att-1-report.pdf',
        size: 2048,
      }),
    });
    expect(
      mockFileContentsByPath['/mock/document/workspace/conv1/attachments/files/att-1-report.pdf'],
    ).toBe(sourceBytes);
    expect(mockLegacyWriteAsStringAsync).not.toHaveBeenCalled();
  });

  it('falls back to base64 persistence when direct attachment copy is unavailable', async () => {
    mockReadAttachmentBase64.mockResolvedValueOnce('YWJjZA==');

    const imported = await importConversationWorkspaceAttachment('conv1', {
      id: 'att-image',
      type: 'image',
      uri: 'file:///missing/photo.png',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 0,
    } as any);

    expect(imported.attachment.workspacePath).toBe('attachments/images/att-image-photo.png');
    expect(imported.attachment.uri).toBe(
      'file:///mock/document/workspace/conv1/attachments/images/att-image-photo.png',
    );
    expect(imported.attachment.size).toBe(4);
    expect(mockLegacyWrites).toContainEqual({
      path: '/mock/document/workspace/conv1/attachments/images/att-image-photo.png',
      content: 'YWJjZA==',
    });
  });
});
