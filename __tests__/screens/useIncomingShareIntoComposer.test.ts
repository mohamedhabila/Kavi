import { renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ResolvedSharePayload } from 'expo-sharing';

const mockClearSharedPayloads = jest.fn();
const mockRefreshSharePayloads = jest.fn();
let mockResolvedSharedPayloads: ResolvedSharePayload[] = [];

jest.mock('expo-sharing', () => ({
  useIncomingShare: () => ({
    resolvedSharedPayloads: mockResolvedSharedPayloads,
    clearSharedPayloads: mockClearSharedPayloads,
    refreshSharePayloads: mockRefreshSharePayloads,
  }),
}));
jest.mock('../../src/services/media/composerImage', () => ({
  prepareComposerImageAttachment: jest.fn(),
}));
const mockReadableUris = new Set<string>();
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ exists: mockReadableUris.has(uri) })),
}));

import { useIncomingShareIntoComposer } from '../../src/screens/useIncomingShareIntoComposer';
import type { Attachment } from '../../src/types/attachment';

const existingAttachment: Attachment = {
  id: 'draft-1',
  type: 'file',
  uri: 'file:///cache/notes.txt',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 10,
};

function render(composerText: string) {
  const onChangeText = jest.fn();
  const onChangeAttachments = jest.fn();
  renderHook(() =>
    useIncomingShareIntoComposer({
      composerAttachments: [existingAttachment],
      composerText,
      onChangeAttachments,
      onChangeText,
    }),
  );
  return { onChangeText, onChangeAttachments };
}

describe('useIncomingShareIntoComposer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvedSharedPayloads = [];
    mockReadableUris.clear();
    mockReadableUris.add('file:///cache/lease.pdf');
  });

  it('adds a share after the draft, then clears it so the next share arrives on its own', async () => {
    mockResolvedSharedPayloads = [
      { value: 'https://example.com/a', shareType: 'url', contentType: 'website' },
      {
        value: 'content://docs/7',
        shareType: 'file',
        contentType: 'file',
        contentUri: 'file:///cache/lease.pdf',
        contentMimeType: 'application/pdf',
        originalName: 'lease.pdf',
        contentSize: 900,
      },
    ] as ResolvedSharePayload[];

    const { onChangeText, onChangeAttachments } = render('Summarize these');

    await waitFor(() => expect(mockRefreshSharePayloads).toHaveBeenCalledTimes(1));
    expect(onChangeText).toHaveBeenCalledWith('Summarize these\n\nhttps://example.com/a');
    expect(onChangeAttachments).toHaveBeenCalledWith([
      existingAttachment,
      expect.objectContaining({ type: 'file', name: 'lease.pdf', uri: 'file:///cache/lease.pdf' }),
    ]);
    expect(mockClearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(mockClearSharedPayloads.mock.invocationCallOrder[0]).toBeLessThan(
      mockRefreshSharePayloads.mock.invocationCallOrder[0],
    );
  });

  it('names what could not be opened instead of attaching it broken', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockResolvedSharedPayloads = [
      {
        value: 'content://media/22',
        shareType: 'image',
        contentType: 'image',
        contentUri: 'file:/cache/22',
        contentMimeType: 'image/png',
        originalName: '22',
        contentSize: null,
      },
    ] as ResolvedSharePayload[];

    const { onChangeAttachments } = render('');

    await waitFor(() => expect(mockRefreshSharePayloads).toHaveBeenCalledTimes(1));
    expect(onChangeAttachments).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "Kavi couldn't open a shared item. Share it again from the app it came from.",
    );
  });

  it('leaves the composer alone when nothing was shared', () => {
    const { onChangeText, onChangeAttachments } = render('');

    expect(onChangeText).not.toHaveBeenCalled();
    expect(onChangeAttachments).not.toHaveBeenCalled();
    expect(mockClearSharedPayloads).not.toHaveBeenCalled();
  });
});
