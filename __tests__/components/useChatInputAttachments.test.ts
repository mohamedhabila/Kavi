import { act, renderHook } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { i18n } from '../../src/i18n/manager';
import {
  type ChatAttachSource,
  useChatInputAttachments,
} from '../../src/components/chat/useChatInputAttachments';

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
const originalPlatform = Platform.OS;

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

/** Opens the sheet, picks a source, and lets the sheet finish closing as iOS reports it. */
async function chooseFromSheet(
  result: ReturnType<typeof setup>['result'],
  source: ChatAttachSource,
): Promise<void> {
  act(() => {
    result.current.handlePickAttachment();
  });
  act(() => {
    result.current.chooseAttachSource(source);
  });
  await act(async () => {
    result.current.handleAttachSheetDismissed();
  });
}

describe('useChatInputAttachments', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  });

  afterEach(() => {
    alertSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('opens the attach sheet instead of a system alert when the model can see images', () => {
    // Regression: the four-button system alert lost Cancel on Android (at most three
    // buttons) and could not be dismissed.
    const { result } = setup({ supportsVision: true });

    act(() => {
      result.current.handlePickAttachment();
    });

    expect(result.current.attachSheetVisible).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('goes straight to the file picker when the model cannot see images', async () => {
    const { result } = setup({ supportsVision: false });

    await act(async () => {
      result.current.handlePickAttachment();
    });

    expect(result.current.attachSheetVisible).toBe(false);
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('ignores the attach button while voice input is active', () => {
    const { result } = setup({ isVoiceActive: true });

    act(() => {
      result.current.handlePickAttachment();
    });

    expect(result.current.attachSheetVisible).toBe(false);
  });

  it('waits on iOS for the sheet to finish closing before opening the picker', () => {
    const { result } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    act(() => {
      result.current.chooseAttachSource('library');
    });

    expect(result.current.attachSheetVisible).toBe(false);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('opens the picker at once on Android, which reports no sheet dismissal', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: true,
      assets: [],
    });
    const { result } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    await act(async () => {
      result.current.chooseAttachSource('library');
    });

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when the sheet is cancelled', async () => {
    const { result } = setup();

    act(() => {
      result.current.handlePickAttachment();
    });
    act(() => {
      result.current.closeAttachSheet();
    });
    await act(async () => {
      result.current.handleAttachSheetDismissed();
    });

    expect(result.current.attachSheetVisible).toBe(false);
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
  });

  it('shows a plain-language permission alert and skips capture when camera access is denied', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const { result, onChangeAttachments } = setup();

    await chooseFromSheet(result, 'camera');

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

    await chooseFromSheet(result, 'camera');

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

    await chooseFromSheet(result, 'camera');

    expect(onChangeAttachments).not.toHaveBeenCalled();
  });
});
