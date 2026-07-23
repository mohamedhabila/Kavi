import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationFilesDirectory } from '../../src/components/files/ConversationFilesDirectory';
import { createConversationFilesStyles } from '../../src/components/files/ConversationFiles.styles';
import type { ConversationWorkspaceDirectoryEntry } from '../../src/services/conversationWorkspace/files';
import type {
  ConversationFileFilter,
  ConversationFileSort,
} from '../../src/components/files/conversationFilesPresentation';

const mockTranslations: Record<string, string> = {
  'common.back': 'Back',
  'common.close': 'Close',
  'common.retry': 'Retry',
  'conversationFiles.title': 'Files & creations',
  'conversationFiles.searchLabel': 'Search files and creations',
  'conversationFiles.searchPlaceholder': 'Search this folder',
  'conversationFiles.clearSearch': 'Clear file search',
  'conversationFiles.refresh': 'Refresh files',
  'conversationFiles.refreshHint': 'Checks this conversation for new or updated files',
  'conversationFiles.filtersLabel': 'File type filters',
  'conversationFiles.filterAll': 'All',
  'conversationFiles.filterDocuments': 'Documents',
  'conversationFiles.filterImages': 'Images',
  'conversationFiles.filterAudio': 'Audio',
  'conversationFiles.filterCode': 'Code',
  'conversationFiles.filterOther': 'Other',
  'conversationFiles.sortNewest': 'Newest',
  'conversationFiles.sortName': 'Name',
  'conversationFiles.sortLabel': 'Sort: {sort}',
  'conversationFiles.sortHint': 'Switches between newest first and alphabetical order',
  'conversationFiles.noMatchesTitle': 'No matching files',
  'conversationFiles.noMatchesHint': 'Try another search or file type.',
  'conversationFiles.untitledItem': 'Untitled item',
  'conversationFiles.openFolderLabel': 'Open folder {name}',
  'conversationFiles.openFileLabel': 'Open file {name}',
  'conversationFiles.shareFileLabel': 'Share or save {name}',
  'conversationFiles.emptyTitle': 'No files yet',
  'conversationFiles.emptyHint': 'Ask the assistant to create files and they will appear here',
  'conversationFiles.loadingTitle': 'Loading files…',
  'conversationFiles.loadErrorTitle': 'Couldn’t load files',
  'conversationFiles.loadErrorHint': 'Check access and try again.',
  'conversationFiles.technicalDetails': 'Details: {detail}',
  'conversationFiles.sharedFromConversation': 'Shared from {title}',
};

function mockTranslate(key: string, params?: Record<string, string | number>): string {
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    mockTranslations[key] ?? key,
  );
}

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({ locale: 'en', t: mockTranslate }),
}));

const colors = {
  background: '#000',
  surface: '#111',
  surfaceAlt: '#18181b',
  border: '#333',
  header: '#111',
  inputBackground: '#18181b',
  placeholder: '#777',
  text: '#fff',
  textSecondary: '#bbb',
  textTertiary: '#888',
  primary: '#22c55e',
  primarySoft: '#123524',
  codeBackground: '#09090b',
} as any;
const styles = createConversationFilesStyles(colors);

const defaultEntries: ConversationWorkspaceDirectoryEntry[] = [
  { name: 'utils', isDirectory: true },
  {
    name: 'README.md',
    isDirectory: false,
    size: 2048,
    modifiedAt: '2026-07-22T12:00:00.000Z',
  },
  { name: 'generated-image.png', isDirectory: false },
  { name: 'index.ts', isDirectory: false },
];

function DirectoryHarness({
  entries = defaultEntries,
  onRefresh = jest.fn(),
}: {
  entries?: ConversationWorkspaceDirectoryEntry[];
  onRefresh?: jest.Mock;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<ConversationFileFilter>('all');
  const [fileSort, setFileSort] = useState<ConversationFileSort>('recent');
  return (
    <ConversationFilesDirectory
      colors={colors}
      currentPath=""
      directoryError={null}
      directoryStatus="ready"
      entries={entries}
      fileFilter={fileFilter}
      fileSort={fileSort}
      isRefreshing={false}
      onClose={jest.fn()}
      onFileFilterChange={setFileFilter}
      onFileSortChange={setFileSort}
      onNavigateInto={jest.fn()}
      onNavigateUp={jest.fn()}
      onOpenFile={jest.fn()}
      onRefresh={onRefresh}
      onSearchQueryChange={setSearchQuery}
      onShareFile={jest.fn()}
      presentation="screen"
      searchQuery={searchQuery}
      styles={styles}
    />
  );
}

describe('ConversationFilesDirectory', () => {
  it('searches the current folder and provides a recoverable no-results state', () => {
    const { getByTestId, getByText, queryByText } = render(<DirectoryHarness />);

    fireEvent.changeText(getByTestId('conversation-files-search'), 'read');
    expect(getByTestId('conversation-files-search').props.accessibilityLabel).toBe(
      'Search files and creations',
    );
    expect(getByText('README.md')).toBeTruthy();
    expect(queryByText('index.ts')).toBeNull();

    fireEvent.changeText(getByTestId('conversation-files-search'), 'missing');
    expect(getByTestId('conversation-files-no-matches')).toBeTruthy();

    fireEvent.press(getByTestId('conversation-files-clear-search'));
    expect(getByText('index.ts')).toBeTruthy();
  });

  it('filters by familiar types while preserving folder navigation', () => {
    const { getByTestId, getByText, queryByText } = render(<DirectoryHarness />);

    fireEvent.press(getByTestId('conversation-files-filter-images'));

    expect(getByTestId('conversation-files-filter-images').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByText('utils')).toBeTruthy();
    expect(getByText('generated-image.png')).toBeTruthy();
    expect(queryByText('index.ts')).toBeNull();
  });

  it('shows retained size and modified metadata', () => {
    const { getByText } = render(<DirectoryHarness />);
    expect(getByText(/Markdown.*Jul 22.*2\.0 KB/)).toBeTruthy();
  });

  it('exposes refresh, filters, sort, and file actions on cross-platform touch targets', () => {
    const onRefresh = jest.fn();
    const { getByTestId } = render(<DirectoryHarness onRefresh={onRefresh} />);

    expect(StyleSheet.flatten(getByTestId('conversation-files-close').props.style).width).toBe(48);
    expect(StyleSheet.flatten(getByTestId('conversation-files-refresh').props.style).height).toBe(
      48,
    );
    expect(
      StyleSheet.flatten(getByTestId('conversation-files-filter-all').props.style).minHeight,
    ).toBe(48);
    expect(StyleSheet.flatten(getByTestId('conversation-files-sort').props.style).minHeight).toBe(
      48,
    );
    expect(
      StyleSheet.flatten(getByTestId('conversation-file-share-README.md').props.style).minHeight,
    ).toBe(48);

    fireEvent.press(getByTestId('conversation-files-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('redacts credential-shaped names from visible and accessible controls', () => {
    const credential = ['gh', 'p_', 'C'.repeat(24)].join('');
    const { getByLabelText, getByTestId, getByText, queryByLabelText, queryByText } = render(
      <DirectoryHarness
        entries={[{ name: `${credential}.txt`, isDirectory: false }]}
      />,
    );

    expect(getByText('[REDACTED].txt')).toBeTruthy();
    expect(getByLabelText('Open file [REDACTED].txt')).toBeTruthy();
    expect(getByTestId('conversation-file-share-[REDACTED].txt')).toBeTruthy();
    expect(queryByText(`${credential}.txt`)).toBeNull();
    expect(queryByLabelText(`Open file ${credential}.txt`)).toBeNull();
  });
});
