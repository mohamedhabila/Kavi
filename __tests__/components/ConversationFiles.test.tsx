// ---------------------------------------------------------------------------
// Tests for ConversationFiles component
// ---------------------------------------------------------------------------

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';

type MockDirectoryEntry = {
  name: string;
  type: 'file' | 'directory';
};

const mockFileContentsByPath: Record<string, string | Error> = {};
const mockDirectoryEntriesByPath: Record<string, MockDirectoryEntry[]> = {};

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

const mockFileExists = jest.fn((path: string) =>
  Object.prototype.hasOwnProperty.call(mockFileContentsByPath, path),
);
const mockFileText = jest.fn(async (path: string) => {
  const content = mockFileContentsByPath[path];
  if (content instanceof Error) {
    throw content;
  }
  return typeof content === 'string' ? content : '(file not found)';
});
const mockDirExists = jest.fn((path: string) =>
  Object.prototype.hasOwnProperty.call(mockDirectoryEntriesByPath, path),
);
const mockDirList = jest.fn((path: string) =>
  (mockDirectoryEntriesByPath[path] || []).map((entry) => {
    const entryPath = mockJoinPath(path, entry.name);
    if (entry.type === 'directory') {
      return {
        name: entry.name,
        uri: mockToFileUri(entryPath),
        list: () => mockDirList(entryPath),
      };
    }

    return {
      name: entry.name,
      uri: mockToFileUri(entryPath),
      text: () => mockFileText(entryPath),
    };
  }),
);

jest.mock('expo-file-system', () => ({
  Paths: { document: '/mock/document' },
  File: jest.fn().mockImplementation((...parts: unknown[]) => {
    const path = mockJoinPath(...parts);
    return {
      exists: mockFileExists(path),
      text: () => mockFileText(path),
      uri: mockToFileUri(path),
    };
  }),
  Directory: jest.fn().mockImplementation((...parts: unknown[]) => {
    const path = mockJoinPath(...parts);
    return {
      exists: mockDirExists(path),
      list: () => mockDirList(path),
      uri: mockToFileUri(path),
    };
  }),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockTranslate = (key: string) =>
  ({
    'common.files': 'Files',
    'conversationFiles.emptyTitle': 'No files yet',
    'conversationFiles.emptyHint': "Ask the assistant to create files and they'll appear here",
    'conversationFiles.binaryPreviewUnavailable': 'Binary file preview unavailable',
    'conversationFiles.imageFileAccessibilityLabel': 'Image file',
    'conversationFiles.fileNotFoundMessage': '(file not found)',
    'conversationFiles.unreadableFileMessage': '(unable to read file — may be binary)',
    'conversationFiles.shareFileFailed': 'Unable to share this file right now.',
    'settings.defaultSystemPrompt': 'Default system prompt',
  })[key] ?? key;

jest.mock('../../src/i18n', () => ({
  i18n: {
    t: (key: string) => mockTranslate(key),
  },
  useTranslation: () => ({
    t: (key: string) => mockTranslate(key),
  }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      header: '#18181b',
      text: '#fff',
      textSecondary: '#bbb',
      textTertiary: '#888',
      primary: '#22c55e',
      primarySoft: '#123524',
      onPrimary: '#fff',
      danger: '#ef4444',
      warning: '#f59e0b',
    },
  }),
  AppPalette: {},
}));

import { ConversationFiles } from '../../src/components/files/ConversationFiles';

describe('ConversationFiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockFileContentsByPath).forEach((key) => {
      delete mockFileContentsByPath[key];
    });
    Object.keys(mockDirectoryEntriesByPath).forEach((key) => {
      delete mockDirectoryEntriesByPath[key];
    });

    mockDirectoryEntriesByPath['/mock/document/workspace/conv1'] = [
      { name: 'utils', type: 'directory' },
      { name: 'index.ts', type: 'file' },
      { name: 'README.md', type: 'file' },
      { name: 'archive.bin', type: 'file' },
      { name: 'generated-image.png', type: 'file' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/conv1/utils'] = [];

    mockFileContentsByPath['/mock/document/workspace/conv1/index.ts'] =
      'console.log("hello world");';
    mockFileContentsByPath['/mock/document/workspace/conv1/README.md'] = '# readme';
    mockFileContentsByPath['/mock/document/workspace/conv1/archive.bin'] = new Error('binary file');
    mockFileContentsByPath['/mock/document/workspace/conv1/generated-image.png'] = new Error(
      'binary file',
    );

    mockDirectoryEntriesByPath['/mock/document/workspace/session-1'] = [
      { name: 'skills', type: 'directory' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/session-1/skills'] = [
      { name: 'prompt-skill', type: 'directory' },
    ];
    mockDirectoryEntriesByPath['/mock/document/workspace/session-1/skills/prompt-skill'] = [
      { name: 'SKILL.md', type: 'file' },
    ];
    mockFileContentsByPath['/mock/document/workspace/session-1/skills/prompt-skill/SKILL.md'] =
      'Always be helpful.';
  });

  it('renders nothing when not visible', () => {
    const { toJSON } = render(
      <ConversationFiles visible={false} onClose={jest.fn()} conversationId="conv1" />,
    );
    expect(toJSON()).toBeNull();
  });

  it('renders file list when visible', async () => {
    const { findByText, getByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    expect(getByText('Files')).toBeTruthy();
    expect(await findByText('index.ts')).toBeTruthy();
    expect(await findByText('utils')).toBeTruthy();
    expect(await findByText('README.md')).toBeTruthy();
  });

  it('shows empty state when no files', async () => {
    mockDirectoryEntriesByPath['/mock/document/workspace/conv1'] = [];
    const { findByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    expect(await findByText('No files yet')).toBeTruthy();
  });

  it('shows empty state when directory does not exist', async () => {
    delete mockDirectoryEntriesByPath['/mock/document/workspace/conv1'];
    const { findByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    expect(await findByText('No files yet')).toBeTruthy();
  });

  it('opens a file when tapped', async () => {
    mockFileContentsByPath['/mock/document/workspace/conv1/index.ts'] = '// file content here';
    const { findByText, getByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    await findByText('index.ts');
    fireEvent.press(getByText('index.ts'));
    await waitFor(() => {
      expect(getByText('// file content here')).toBeTruthy();
    });
  });

  it('delegates text files to the editor callback when provided', async () => {
    const onOpenTextFile = jest.fn();
    const { findByText, getByText, queryByText } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        onOpenTextFile={onOpenTextFile}
      />,
    );

    await findByText('index.ts');
    fireEvent.press(getByText('index.ts'));

    await waitFor(() => {
      expect(onOpenTextFile).toHaveBeenCalledWith(
        'index.ts',
        'console.log("hello world");',
        'conv1',
      );
    });
    expect(queryByText('console.log("hello world");')).toBeNull();
  });

  it('shows fallback workspace directories and opens fallback text files from their source workspace', async () => {
    const onOpenTextFile = jest.fn();
    const { findByText, getByText } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        fallbackConversationIds={['session-1']}
        onOpenTextFile={onOpenTextFile}
      />,
    );

    await findByText('skills');
    fireEvent.press(getByText('skills'));

    await findByText('prompt-skill');
    fireEvent.press(getByText('prompt-skill'));

    await findByText('SKILL.md');
    fireEvent.press(getByText('SKILL.md'));

    await waitFor(() => {
      expect(onOpenTextFile).toHaveBeenCalledWith(
        'skills/prompt-skill/SKILL.md',
        'Always be helpful.',
        'session-1',
      );
    });
  });

  it('refreshes directory entries when the refresh token changes', async () => {
    const { findByText, queryByText, rerender } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        refreshToken="initial"
      />,
    );

    expect(await findByText('index.ts')).toBeTruthy();
    expect(queryByText('later.md')).toBeNull();

    mockDirectoryEntriesByPath['/mock/document/workspace/conv1'] = [
      { name: 'utils', type: 'directory' },
      { name: 'index.ts', type: 'file' },
      { name: 'README.md', type: 'file' },
      { name: 'generated-image.png', type: 'file' },
      { name: 'later.md', type: 'file' },
    ];
    mockFileContentsByPath['/mock/document/workspace/conv1/later.md'] = '# later';

    rerender(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        refreshToken="after-worker-write"
      />,
    );

    expect(await findByText('later.md')).toBeTruthy();
  });

  it('shows binary preview state for unreadable files', async () => {
    const { findByText, getByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );

    await findByText('archive.bin');
    fireEvent.press(getByText('archive.bin'));

    await waitFor(() => {
      expect(getByText('Binary file preview unavailable')).toBeTruthy();
      expect(getByText('(unable to read file — may be binary)')).toBeTruthy();
    });
  });

  it('shows a file-not-found message when opening a missing path directly', async () => {
    const { getByText } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        initialFilePath="missing.txt"
      />,
    );

    await waitFor(() => {
      expect(getByText('(file not found)')).toBeTruthy();
    });
  });

  it('copies and shares file content from the viewer header actions', async () => {
    const setStringAsync = jest.spyOn(Clipboard, 'setStringAsync');
    const shareAsync = jest.spyOn(Sharing, 'shareAsync');
    const { UNSAFE_getAllByType } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        initialFilePath="README.md"
      />,
    );

    await waitFor(() => {
      expect(setStringAsync).not.toHaveBeenCalled();
    });

    const buttons = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    fireEvent.press(buttons[1]);
    fireEvent.press(buttons[2]);

    await waitFor(() => {
      expect(setStringAsync).toHaveBeenCalledWith('# readme');
      expect(shareAsync).toHaveBeenCalledWith(
        'file:///mock/document/workspace/conv1/README.md',
        expect.objectContaining({
          dialogTitle: 'README.md',
          mimeType: 'text/markdown',
          UTI: 'net.daringfireball.markdown',
        }),
      );
    });
  });

  it('shares a file directly from the directory list when text files open in the editor', async () => {
    const onOpenTextFile = jest.fn();
    const shareAsync = jest.spyOn(Sharing, 'shareAsync');
    const { findByText, getByTestId } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        onOpenTextFile={onOpenTextFile}
      />,
    );

    await findByText('README.md');
    fireEvent.press(getByTestId('conversation-file-share-README.md'));

    await waitFor(() => {
      expect(shareAsync).toHaveBeenCalledWith(
        'file:///mock/document/workspace/conv1/README.md',
        expect.objectContaining({
          dialogTitle: 'README.md',
          mimeType: 'text/markdown',
          UTI: 'net.daringfireball.markdown',
        }),
      );
    });
    expect(onOpenTextFile).not.toHaveBeenCalled();
  });

  it('navigates into subdirectory', async () => {
    const { findByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    expect(await findByText('utils')).toBeTruthy();
  });

  it('shows file type from extension', async () => {
    mockFileContentsByPath['/mock/document/workspace/conv1/index.ts'] = 'const x = 1;';
    const { findByText, getByText } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );
    await findByText('index.ts');
    fireEvent.press(getByText('index.ts'));
    await waitFor(() => {
      expect(getByText(/TypeScript/)).toBeTruthy();
    });
  });

  it('opens image files in an image preview viewer', async () => {
    const { findByText, getByText, getByTestId } = render(
      <ConversationFiles visible={true} onClose={jest.fn()} conversationId="conv1" />,
    );

    await findByText('generated-image.png');
    fireEvent.press(getByText('generated-image.png'));

    await waitFor(() => {
      expect(getByTestId('conversation-file-image-preview')).toBeTruthy();
    });
  });

  it('opens the requested workspace file directly when initialFilePath is provided', async () => {
    const { getByTestId, getByText } = render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        initialFilePath="generated-image.png"
      />,
    );

    await waitFor(() => {
      expect(getByTestId('conversation-file-image-preview')).toBeTruthy();
    });
    expect(getByText('generated-image.png')).toBeTruthy();
  });

  it('delegates the requested initial text file to the editor callback when provided', async () => {
    const onOpenTextFile = jest.fn();

    render(
      <ConversationFiles
        visible={true}
        onClose={jest.fn()}
        conversationId="conv1"
        initialFilePath="README.md"
        onOpenTextFile={onOpenTextFile}
      />,
    );

    await waitFor(() => {
      expect(onOpenTextFile).toHaveBeenCalledWith('README.md', '# readme', 'conv1');
    });
  });

  it('restores a requested directory when rendered as a full screen', async () => {
    const { findByText, getByText, queryByText } = render(
      <ConversationFiles
        visible={true}
        presentation="screen"
        onClose={jest.fn()}
        conversationId="conv1"
        initialDirectoryPath="utils"
      />,
    );

    expect(getByText('/utils')).toBeTruthy();
    expect(queryByText('index.ts')).toBeNull();
    expect(await findByText('No files yet')).toBeTruthy();
  });
});
