import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { i18n } from '../../src/i18n/manager';
import { useChatInputAttachments } from '../../src/components/chat/useChatInputAttachments';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

function setup(overrides?: Partial<Parameters<typeof useChatInputAttachments>[0]>) {
  const onChangeAttachments = jest.fn();
  const clearVoiceError = jest.fn();
  const params = {
    attachments: [],
    clearVoiceError,
    isInputDisabled: false,
    isVoiceActive: false,
    onChangeAttachments,
    supportsVision: true,
    t,
    ...overrides,
  };
  const { result } = renderHook(() => useChatInputAttachments(params));
  return { result, onChangeAttachments, clearVoiceError };
}

describe('useChatInputAttachments camera capture', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('offers a Take Photo option alongside Image and File when vision is supported', () => {
    const { result } = setup({ supportsVision: true });

    act(() => {
      result.current.handlePickAttachment();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [, , buttons] = alertSpy.mock.calls[0];
    const buttonLabels = buttons.map((button: { text?: string }) => button.text);
    expect(buttonLabels).toContain(i18n.t('chat.takePhoto'));
    expect(buttonLabels).toContain(i18n.t('common.image'));
    expect(buttonLabels).toContain(i18n.t('common.file'));
  });

  it('does not offer Take Photo when the active model has no vision support', () => {
    const { result } = setup({ supportsVision: false });

    act(() => {
      result.current.handlePickAttachment();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('shows a plain-language permission alert and skips capture when camera access is denied', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
    });
    const { result, onChangeAttachments } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    const [, , buttons] = alertSpy.mock.calls[0];
    const takePhoto = buttons.find(
      (button: { text?: string }) => button.text === i18n.t('chat.takePhoto'),
    );

    await act(async () => {
      await takePhoto.onPress();
    });

    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(onChangeAttachments).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      i18n.t('chat.cameraPermissionTitle'),
      i18n.t('chat.cameraPermissionMessage'),
    );
  });

  it('adds a captured photo to the attachment pipeline when permission is granted', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///photo.jpg',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1234,
        },
      ],
    });
    const { result, onChangeAttachments, clearVoiceError } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    const [, , buttons] = alertSpy.mock.calls[0];
    const takePhoto = buttons.find(
      (button: { text?: string }) => button.text === i18n.t('chat.takePhoto'),
    );

    await act(async () => {
      await takePhoto.onPress();
    });

    expect(clearVoiceError).toHaveBeenCalled();
    expect(onChangeAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'image',
        uri: 'file:///photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 1234,
      }),
    ]);
  });

  it('does nothing when the user cancels the camera', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    const { result, onChangeAttachments } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    const [, , buttons] = alertSpy.mock.calls[0];
    const takePhoto = buttons.find(
      (button: { text?: string }) => button.text === i18n.t('chat.takePhoto'),
    );

    await act(async () => {
      await takePhoto.onPress();
    });

    expect(onChangeAttachments).not.toHaveBeenCalled();
  });
});
