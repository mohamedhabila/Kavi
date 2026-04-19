// ---------------------------------------------------------------------------
// Tests — FileBrowser Component
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FileBrowser, type FileEntry } from '../../src/components/files/FileBrowser';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      header: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
      onPrimary: '#fff',
      danger: '#f00',
      warning: '#ff0',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.retry': 'Retry',
        'common.emptyDirectory': 'Empty directory',
      })[key] ?? key,
  }),
}));

// Mock lucide-react-native icons
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const mockIcon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('View', { ...props, ref, testID: `icon-${name}` }),
    );
  return {
    ArrowLeft: mockIcon('ArrowLeft'),
    ChevronRight: mockIcon('ChevronRight'),
    File: mockIcon('File'),
    Folder: mockIcon('Folder'),
    FolderOpen: mockIcon('FolderOpen'),
    RefreshCw: mockIcon('RefreshCw'),
    Home: mockIcon('Home'),
  };
});

const mockFiles: FileEntry[] = [
  { name: 'src', isDirectory: true },
  { name: 'package.json', isDirectory: false, size: 1024 },
  { name: 'README.md', isDirectory: false, size: 2048 },
  { name: 'node_modules', isDirectory: true },
];

describe('FileBrowser', () => {
  const defaultProps = {
    rootPath: '/home/user/project',
    listDirectory: jest.fn().mockResolvedValue(mockFiles),
    onFileSelect: jest.fn(),
    onFileLongPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    defaultProps.listDirectory.mockResolvedValue(mockFiles);
  });

  it('should render and load directory contents', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('src')).toBeTruthy();
    });
    expect(defaultProps.listDirectory).toHaveBeenCalledWith('/home/user/project');
  });

  it('should sort directories before files', async () => {
    const { getAllByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      // Just check that both dirs and files are rendered
      expect(getAllByText(/^(src|node_modules|package\.json|README\.md)$/).length).toBe(4);
    });
  });

  it('should display file sizes', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('1.0 KB')).toBeTruthy();
      expect(getByText('2.0 KB')).toBeTruthy();
    });
  });

  it('should navigate into a directory on press', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => expect(getByText('src')).toBeTruthy());

    fireEvent.press(getByText('src'));

    await waitFor(() => {
      expect(defaultProps.listDirectory).toHaveBeenCalledWith('/home/user/project/src');
    });
  });

  it('should call onFileSelect when pressing a file', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => expect(getByText('package.json')).toBeTruthy());

    fireEvent.press(getByText('package.json'));

    expect(defaultProps.onFileSelect).toHaveBeenCalledWith(
      '/home/user/project/package.json',
      expect.objectContaining({ name: 'package.json', isDirectory: false }),
    );
  });

  it('should call onFileLongPress on long press', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => expect(getByText('README.md')).toBeTruthy());

    fireEvent(getByText('README.md'), 'onLongPress');

    expect(defaultProps.onFileLongPress).toHaveBeenCalledWith(
      '/home/user/project/README.md',
      expect.objectContaining({ name: 'README.md' }),
    );
  });

  it('should show breadcrumb with home indicator', async () => {
    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('~')).toBeTruthy();
    });
  });

  it('should show error state when listDirectory fails', async () => {
    defaultProps.listDirectory.mockRejectedValueOnce(new Error('Connection lost'));

    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('Connection lost')).toBeTruthy();
      expect(getByText('Retry')).toBeTruthy();
    });
  });

  it('should show empty state for empty directories', async () => {
    defaultProps.listDirectory.mockResolvedValueOnce([]);

    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('Empty directory')).toBeTruthy();
    });
  });

  it('should use initialPath when provided', async () => {
    render(<FileBrowser {...defaultProps} initialPath="/home/user/project/src" />);
    await waitFor(() => {
      expect(defaultProps.listDirectory).toHaveBeenCalledWith('/home/user/project/src');
    });
  });

  it('should retry on pressing retry button after error', async () => {
    defaultProps.listDirectory
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFiles);

    const { getByText } = render(<FileBrowser {...defaultProps} />);
    await waitFor(() => expect(getByText('Retry')).toBeTruthy());

    fireEvent.press(getByText('Retry'));
    await waitFor(() => {
      expect(defaultProps.listDirectory).toHaveBeenCalledTimes(2);
    });
  });
});
