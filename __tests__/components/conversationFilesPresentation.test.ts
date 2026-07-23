import {
  formatConversationFileSize,
  getConversationFileCategory,
  getSafeConversationFileName,
  getVisibleConversationFileEntries,
} from '../../src/components/files/conversationFilesPresentation';
import type { FileEntry } from '../../src/services/files/contracts';

const entries: FileEntry[] = [
  { name: 'folder', isDirectory: true },
  { name: 'notes.pdf', isDirectory: false, modifiedAt: '2026-07-20T10:00:00.000Z' },
  { name: 'photo.png', isDirectory: false, modifiedAt: '2026-07-23T10:00:00.000Z' },
  { name: 'app.ts', isDirectory: false, modifiedAt: '2026-07-22T10:00:00.000Z' },
];

describe('conversation files presentation', () => {
  it.each([
    ['report.pdf', 'documents'],
    ['budget.xlsx', 'documents'],
    ['briefing.pptx', 'documents'],
    ['photo.heic', 'images'],
    ['recording.m4a', 'audio'],
    ['screen.tsx', 'code'],
    ['archive.zip', 'other'],
  ] as const)('classifies %s as %s', (name, category) => {
    expect(getConversationFileCategory(name)).toBe(category);
  });

  it('filters the current folder while preserving directory navigation', () => {
    expect(getVisibleConversationFileEntries(entries, '', 'images', 'name').map((entry) => entry.name)).toEqual([
      'folder',
      'photo.png',
    ]);
    expect(getVisibleConversationFileEntries(entries, 'app', 'all', 'name').map((entry) => entry.name)).toEqual([
      'app.ts',
    ]);
  });

  it('sorts files by newest or name with folders first', () => {
    expect(getVisibleConversationFileEntries(entries, '', 'all', 'recent').map((entry) => entry.name)).toEqual([
      'folder',
      'photo.png',
      'app.ts',
      'notes.pdf',
    ]);
    expect(getVisibleConversationFileEntries(entries, '', 'all', 'name').map((entry) => entry.name)).toEqual([
      'folder',
      'app.ts',
      'notes.pdf',
      'photo.png',
    ]);
  });

  it('formats sizes and redacts credential-shaped file names', () => {
    const credential = ['gh', 'p_', 'B'.repeat(24)].join('');
    expect(formatConversationFileSize(1536)).toBe('1.5 KB');
    expect(getSafeConversationFileName(`${credential}.txt`, 'Untitled item')).toBe(
      '[REDACTED].txt',
    );
  });
});
