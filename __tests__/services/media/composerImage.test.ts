const mockResize = jest.fn();
const mockRenderAsync = jest.fn();
const mockSaveAsync = jest.fn();
const mockManipulate = jest.fn();
const mockFileSize = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ size: mockFileSize(uri) })),
}));

import {
  COMPOSER_IMAGE_JPEG_QUALITY,
  COMPOSER_IMAGE_MAX_EDGE,
  prepareComposerImageAttachment,
} from '../../../src/services/media/composerImage';

// A phone photo is several times larger than any provider reads. The composer attaches it
// scaled to the largest size providers use, so each request that carries it uploads less.

const PHOTO = {
  uri: 'file:///picked/photo.HEIC',
  width: 4032,
  height: 3024,
  fileName: 'IMG_0001.HEIC',
  mimeType: 'image/heic',
  fileSize: 3_400_000,
};

beforeEach(() => {
  jest.clearAllMocks();
  const context = { resize: mockResize, renderAsync: mockRenderAsync };
  mockResize.mockReturnValue(context);
  mockManipulate.mockReturnValue(context);
  mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  mockSaveAsync.mockResolvedValue({ uri: 'file:///cache/scaled.jpg', width: 2048, height: 1536 });
  mockFileSize.mockReturnValue(410_000);
});

describe('prepareComposerImageAttachment', () => {
  it('scales a large photo to the provider ceiling and re-encodes it as JPEG', async () => {
    const attachment = await prepareComposerImageAttachment(PHOTO, 'attachment-1', 'image.jpg');

    expect(mockManipulate).toHaveBeenCalledWith('file:///picked/photo.HEIC');
    expect(mockResize).toHaveBeenCalledWith({ width: COMPOSER_IMAGE_MAX_EDGE, height: null });
    expect(mockSaveAsync).toHaveBeenCalledWith({
      format: 'jpeg',
      compress: COMPOSER_IMAGE_JPEG_QUALITY,
    });
    expect(attachment).toEqual({
      id: 'attachment-1',
      type: 'image',
      uri: 'file:///cache/scaled.jpg',
      name: 'IMG_0001.jpg',
      mimeType: 'image/jpeg',
      size: 410_000,
    });
  });

  it('scales a portrait photo by its height', async () => {
    await prepareComposerImageAttachment(
      { ...PHOTO, width: 3024, height: 4032, mimeType: 'image/jpeg' },
      'attachment-1',
      'image.jpg',
    );

    expect(mockResize).toHaveBeenCalledWith({ width: null, height: COMPOSER_IMAGE_MAX_EDGE });
  });

  it('keeps a PNG lossless so transparency survives', async () => {
    const attachment = await prepareComposerImageAttachment(
      { ...PHOTO, fileName: 'diagram.png', mimeType: 'image/png' },
      'attachment-1',
      'image.jpg',
    );

    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'png' });
    expect(attachment).toMatchObject({ name: 'diagram.png', mimeType: 'image/png' });
  });

  it('attaches a photo already within bounds untouched', async () => {
    const attachment = await prepareComposerImageAttachment(
      { ...PHOTO, width: 1600, height: 1200, fileName: 'small.jpg', mimeType: 'image/jpeg' },
      'attachment-1',
      'image.jpg',
    );

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(attachment).toEqual({
      id: 'attachment-1',
      type: 'image',
      uri: 'file:///picked/photo.HEIC',
      name: 'small.jpg',
      mimeType: 'image/jpeg',
      size: 3_400_000,
    });
  });

  it('re-encodes a small HEIC photo without resizing it', async () => {
    await prepareComposerImageAttachment(
      { ...PHOTO, width: 800, height: 600 },
      'attachment-1',
      'image.jpg',
    );

    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
  });

  it('leaves animated GIFs alone however large they are', async () => {
    await prepareComposerImageAttachment(
      { ...PHOTO, mimeType: 'image/gif', fileName: 'loop.gif' },
      'attachment-1',
      'image.jpg',
    );

    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('attaches the original when the photo cannot be processed', async () => {
    mockRenderAsync.mockRejectedValue(new Error('decoder unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const attachment = await prepareComposerImageAttachment(PHOTO, 'attachment-1', 'image.jpg');

    expect(attachment).toMatchObject({ uri: 'file:///picked/photo.HEIC', size: 3_400_000 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('names a photo the picker left unnamed', async () => {
    const attachment = await prepareComposerImageAttachment(
      { uri: 'file:///picked/x', width: 100, height: 100 },
      'attachment-1',
      'photo.jpg',
    );

    expect(attachment).toMatchObject({ name: 'photo.jpg', mimeType: 'image/jpeg', size: 0 });
  });
});
