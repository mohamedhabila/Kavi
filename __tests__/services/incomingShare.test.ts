import type { ResolvedSharePayload } from 'expo-sharing';
import {
  buildIncomingShareInput,
  normalizeSharedFileUri,
  type IncomingShareDependencies,
} from '../../src/services/share/incomingShare';

function payload(overrides: Partial<ResolvedSharePayload>): ResolvedSharePayload {
  return {
    value: '',
    shareType: 'text',
    contentUri: null,
    contentType: 'text',
    contentMimeType: null,
    originalName: null,
    contentSize: null,
    ...overrides,
  } as ResolvedSharePayload;
}

function dependencies(): IncomingShareDependencies & {
  fileExists: jest.Mock;
  measureImage: jest.Mock;
  prepareImage: jest.Mock;
} {
  let next = 0;
  return {
    createId: () => `att-${(next += 1)}`,
    fileExists: jest.fn().mockReturnValue(true),
    measureImage: jest.fn().mockResolvedValue({ width: 4032, height: 3024 }),
    prepareImage: jest.fn(async (image, id, fallbackName) => ({
      id,
      type: 'image' as const,
      uri: `${image.uri}#prepared`,
      name: image.fileName || fallbackName,
      mimeType: image.mimeType || 'image/jpeg',
      size: image.fileSize || 0,
    })),
  };
}

describe('incoming share into the composer', () => {
  it('puts shared text and links in the draft text, once each', async () => {
    const input = await buildIncomingShareInput(
      [
        payload({ value: 'Read this before Friday', shareType: 'text' }),
        payload({ value: 'https://example.com/report', shareType: 'url', contentType: 'website' }),
        payload({ value: 'https://example.com/report', shareType: 'text' }),
      ],
      dependencies(),
    );

    expect(input).toEqual({
      text: 'Read this before Friday\n\nhttps://example.com/report',
      attachments: [],
      unreadableCount: 0,
    });
  });

  it('attaches a shared photo through the composer image step, measured first', async () => {
    const deps = dependencies();

    const input = await buildIncomingShareInput(
      [
        payload({
          value: 'content://media/42',
          shareType: 'image',
          contentType: 'image',
          contentUri: 'file:/data/user/0/com.kavi.mobile/cache/IMG_1.heic',
          contentMimeType: 'image/heic',
          originalName: 'IMG_1.heic',
          contentSize: 2_000_000,
        }),
      ],
      deps,
    );

    expect(deps.measureImage).toHaveBeenCalledWith(
      'file:///data/user/0/com.kavi.mobile/cache/IMG_1.heic',
    );
    expect(deps.prepareImage).toHaveBeenCalledWith(
      {
        uri: 'file:///data/user/0/com.kavi.mobile/cache/IMG_1.heic',
        width: 4032,
        height: 3024,
        fileName: 'IMG_1.heic',
        mimeType: 'image/heic',
        fileSize: 2_000_000,
      },
      'att-1',
      'IMG_1.heic',
    );
    expect(input.attachments).toEqual([
      expect.objectContaining({ id: 'att-1', type: 'image', name: 'IMG_1.heic' }),
    ]);
  });

  it('still attaches a photo whose size cannot be read', async () => {
    const deps = dependencies();
    deps.measureImage.mockRejectedValueOnce(new Error('decode failed'));

    const input = await buildIncomingShareInput(
      [payload({ shareType: 'image', contentType: 'image', contentUri: 'file:///cache/a.png' })],
      deps,
    );

    expect(deps.prepareImage.mock.calls[0]?.[0]).toMatchObject({ width: NaN, height: NaN });
    expect(input.attachments).toHaveLength(1);
  });

  it('attaches shared files as files, naming the unnamed by their type', async () => {
    const input = await buildIncomingShareInput(
      [
        payload({
          shareType: 'file',
          contentType: 'file',
          contentUri: 'file:/cache/lease.pdf',
          contentMimeType: 'application/pdf',
          originalName: 'lease.pdf',
          contentSize: 81_920,
        }),
        payload({
          shareType: 'audio',
          contentType: 'audio',
          contentUri: 'file:///cache/voice',
          contentMimeType: 'audio/ogg',
        }),
      ],
      dependencies(),
    );

    expect(input.attachments).toEqual([
      {
        id: 'att-1',
        type: 'file',
        uri: 'file:///cache/lease.pdf',
        name: 'lease.pdf',
        mimeType: 'application/pdf',
        size: 81_920,
      },
      {
        id: 'att-2',
        type: 'file',
        uri: 'file:///cache/voice',
        name: 'shared-2.ogg',
        mimeType: 'audio/ogg',
        size: 0,
      },
    ]);
  });

  // A copy that failed (the sharing app did not grant Kavi access) used to be attached as an
  // empty file with a blank thumbnail. It is counted instead, so the person can be told.
  it('counts shared files that could not be copied instead of attaching them', async () => {
    const deps = dependencies();
    deps.fileExists.mockImplementation((uri: string) => !uri.endsWith('/22'));

    const input = await buildIncomingShareInput(
      [
        payload({ shareType: 'image', contentType: 'image', contentUri: 'file:/cache/22' }),
        payload({ shareType: 'file', contentType: 'file', contentUri: null }),
        payload({ shareType: 'file', contentType: 'file', contentUri: 'file:/cache/ok.pdf' }),
        payload({ value: '  ' }),
      ],
      deps,
    );

    expect(deps.prepareImage).not.toHaveBeenCalled();
    expect(input).toEqual({
      text: '',
      attachments: [expect.objectContaining({ uri: 'file:///cache/ok.pdf' })],
      unreadableCount: 2,
    });
  });

  // A shared text file resolves as shareType "text" with content; it used to be read as the
  // share's text, which put its content:// address in the draft.
  it('attaches a shared text file instead of pasting its address', async () => {
    const input = await buildIncomingShareInput(
      [
        payload({
          value: 'content://com.example.files/notes.md',
          shareType: 'text',
          contentType: 'text',
          contentUri: 'file:/cache/notes.md',
          contentMimeType: 'text/markdown',
          originalName: 'notes.md',
          contentSize: 120,
        }),
      ],
      dependencies(),
    );

    expect(input).toEqual({
      text: '',
      attachments: [
        expect.objectContaining({ type: 'file', name: 'notes.md', mimeType: 'text/markdown' }),
      ],
      unreadableCount: 0,
    });
  });

  it.each([
    ['file:/data/x.pdf', 'file:///data/x.pdf'],
    ['file:///data/x.pdf', 'file:///data/x.pdf'],
    ['content://media/1', 'content://media/1'],
  ])('normalizes %s to %s', (uri, expected) => {
    expect(normalizeSharedFileUri(uri)).toBe(expected);
  });
});
