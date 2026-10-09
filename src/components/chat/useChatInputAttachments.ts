import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { Attachment } from '../../types/attachment';
import { generateId } from '../../utils/id';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

export type ChatAttachSource = 'camera' | 'library' | 'file';

type UseChatInputAttachmentsParams = {
  attachments: Attachment[];
  clearVoiceError: () => void;
  isInputDisabled: boolean;
  isVoiceActive: boolean;
  onChangeAttachments: (attachments: Attachment[]) => void;
  supportsVision?: boolean;
  t: TranslationFn;
};

export function useChatInputAttachments(params: UseChatInputAttachmentsParams) {
  const {
    attachments,
    clearVoiceError,
    isInputDisabled,
    isVoiceActive,
    onChangeAttachments,
    supportsVision,
    t,
  } = params;

  const handlePickImage = useCallback(async () => {
    clearVoiceError();
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      onChangeAttachments([
        ...attachments,
        {
          id: generateId(),
          type: 'image',
          uri: asset.uri,
          name: asset.fileName || 'image.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
          size: asset.fileSize || 0,
        },
      ]);
    }
  }, [attachments, clearVoiceError, onChangeAttachments]);

  const handleTakePhoto = useCallback(async () => {
    clearVoiceError();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('chat.cameraPermissionTitle'), t('chat.cameraPermissionMessage'));
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      onChangeAttachments([
        ...attachments,
        {
          id: generateId(),
          type: 'image',
          uri: asset.uri,
          name: asset.fileName || 'photo.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
          size: asset.fileSize || 0,
        },
      ]);
    }
  }, [attachments, clearVoiceError, onChangeAttachments, t]);

  const handlePickDocument = useCallback(async () => {
    clearVoiceError();
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      onChangeAttachments([
        ...attachments,
        {
          id: generateId(),
          type: 'file',
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType || 'application/octet-stream',
          size: asset.size || 0,
        },
      ]);
    }
  }, [attachments, clearVoiceError, onChangeAttachments]);

  const [attachSheetVisible, setAttachSheetVisible] = useState(false);
  // iOS cannot present the camera or a picker while the sheet is still animating away,
  // so the chosen source waits for the sheet's dismissal there; Android launches at once.
  const pendingSourceRef = useRef<ChatAttachSource | null>(null);

  const launchAttachSource = useCallback(
    (source: ChatAttachSource) => {
      if (source === 'camera') {
        void handleTakePhoto();
      } else if (source === 'library') {
        void handlePickImage();
      } else {
        void handlePickDocument();
      }
    },
    [handlePickDocument, handlePickImage, handleTakePhoto],
  );

  const handlePickAttachment = useCallback(() => {
    if (isVoiceActive || isInputDisabled) {
      return;
    }

    if (!supportsVision) {
      void handlePickDocument();
      return;
    }

    setAttachSheetVisible(true);
  }, [handlePickDocument, isInputDisabled, isVoiceActive, supportsVision]);

  const closeAttachSheet = useCallback(() => {
    pendingSourceRef.current = null;
    setAttachSheetVisible(false);
  }, []);

  const chooseAttachSource = useCallback(
    (source: ChatAttachSource) => {
      setAttachSheetVisible(false);
      if (Platform.OS === 'ios') {
        pendingSourceRef.current = source;
        return;
      }
      launchAttachSource(source);
    },
    [launchAttachSource],
  );

  const handleAttachSheetDismissed = useCallback(() => {
    const source = pendingSourceRef.current;
    pendingSourceRef.current = null;
    if (source) {
      launchAttachSource(source);
    }
  }, [launchAttachSource]);

  const removeAttachment = useCallback(
    (id: string) => {
      onChangeAttachments(attachments.filter((attachment) => attachment.id !== id));
    },
    [attachments, onChangeAttachments],
  );

  return {
    attachSheetVisible,
    chooseAttachSource,
    closeAttachSheet,
    handleAttachSheetDismissed,
    handlePickAttachment,
    removeAttachment,
  };
}
