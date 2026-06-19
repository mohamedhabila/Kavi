import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { Attachment } from '../../types/attachment';
import { generateId } from '../../utils/id';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

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

  const handlePickAttachment = useCallback(() => {
    if (isVoiceActive || isInputDisabled) {
      return;
    }

    if (!supportsVision) {
      void handlePickDocument();
      return;
    }

    Alert.alert(t('chat.attach'), undefined, [
      {
        text: t('common.image'),
        onPress: () => {
          void handlePickImage();
        },
      },
      {
        text: t('common.file'),
        onPress: () => {
          void handlePickDocument();
        },
      },
      {
        text: t('common.cancel'),
        style: 'cancel',
      },
    ]);
  }, [
    handlePickDocument,
    handlePickImage,
    isInputDisabled,
    isVoiceActive,
    supportsVision,
    t,
  ]);

  const removeAttachment = useCallback(
    (id: string) => {
      onChangeAttachments(attachments.filter((attachment) => attachment.id !== id));
    },
    [attachments, onChangeAttachments],
  );

  return {
    handlePickAttachment,
    removeAttachment,
  };
}
