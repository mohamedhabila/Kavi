// ---------------------------------------------------------------------------
// Kavi — ChatInput Component
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Send, Square, Paperclip, X, Mic } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Attachment } from '../../types';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { generateId } from '../../utils/id';
import { AttachmentPreview } from './AttachmentPreview';
import { useTranslation } from '../../i18n';
import { getAllCommands } from '../../services/commands/builtins';
import { useChatVoiceRecorder } from './useChatVoiceRecorder';
import { VoiceRecorderOverlay } from './VoiceRecorderOverlay';
import { CHAT_VOICE_PRESS_RETENTION_OFFSET } from './chatVoiceConstants';

interface ChatInputProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  isLoading: boolean;
  isInputDisabled?: boolean;
  text: string;
  onChangeText: (text: string) => void;
  attachments: Attachment[];
  onChangeAttachments: (attachments: Attachment[]) => void;
  isEditing?: boolean;
  onCancelEdit?: () => void;
  supportsVision?: boolean;
  bottomInset?: number;
}

export const ChatInput: React.FC<ChatInputProps> = React.memo(
  ({
    onSend,
    onStop,
    isLoading,
    isInputDisabled = false,
    text,
    onChangeText,
    attachments,
    onChangeAttachments,
    isEditing = false,
    onCancelEdit,
    supportsVision,
    bottomInset = 0,
  }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = useMemo(() => createStyles(colors, bottomInset), [bottomInset, colors]);
    const inputRef = useRef<TextInput>(null);

    const allCommands = useMemo(() => getAllCommands(), []);
    const commandSuggestions = useMemo(() => {
      if (!text.startsWith('/')) return [];
      const query = text.slice(1).toLowerCase();
      return allCommands.filter((c) => c.name.slice(1).toLowerCase().startsWith(query)).slice(0, 6);
    }, [text, allCommands]);

    const voiceRecorder = useChatVoiceRecorder({
      disabled: isLoading || isEditing || isInputDisabled,
      messages: {
        noSpeechDetected: t('chat.voiceNoSpeechDetected'),
        microphonePermissionDenied: t('chat.voicePermissionDenied'),
        genericFailure: t('chat.voiceGenericFailure'),
      },
      onVoiceNoteReady: ({ transcript, attachment }) => {
        void Promise.resolve()
          .then(() => onSend(transcript, [attachment]))
          .catch(() => {});
      },
    });

    useEffect(() => {
      if (!isEditing) {
        return;
      }

      inputRef.current?.focus();
    }, [isEditing]);

    const handleSend = useCallback(() => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      voiceRecorder.clearError();
      onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    }, [attachments, onSend, text, voiceRecorder]);

    const handlePickImage = useCallback(async () => {
      voiceRecorder.clearError();
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
    }, [attachments, onChangeAttachments, voiceRecorder]);

    const handlePickDocument = useCallback(async () => {
      voiceRecorder.clearError();
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
    }, [attachments, onChangeAttachments, voiceRecorder]);

    const handlePickAttachment = useCallback(() => {
      if (voiceRecorder.isActive || isInputDisabled) {
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
      supportsVision,
      t,
      voiceRecorder.isActive,
    ]);

    const removeAttachment = useCallback(
      (id: string) => {
        onChangeAttachments(attachments.filter((attachment) => attachment.id !== id));
      },
      [attachments, onChangeAttachments],
    );

    const handleTextChange = useCallback(
      (value: string) => {
        if (voiceRecorder.errorMessage) {
          voiceRecorder.clearError();
        }
        onChangeText(value);
      },
      [onChangeText, voiceRecorder],
    );

    const composerDisabled = isInputDisabled || voiceRecorder.isActive;
    const sendDisabled = composerDisabled || (!text.trim() && attachments.length === 0);
    const showStopButton = isLoading && !text.trim() && attachments.length === 0;

    return (
      <View style={styles.container}>
        {isEditing && onCancelEdit && (
          <View style={styles.editingBar}>
            <Text style={styles.editingLabel}>{t('chat.editMessage')}</Text>
            <TouchableOpacity
              onPress={onCancelEdit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('chat.cancelEdit')}
            >
              <X size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        {attachments.length > 0 && (
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
        )}
        {voiceRecorder.errorMessage ? (
          <View style={styles.voiceErrorBanner}>
            <Text style={styles.voiceErrorText}>{voiceRecorder.errorMessage}</Text>
          </View>
        ) : null}
        {commandSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              data={commandSuggestions}
              keyExtractor={(item) => item.name}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => {
                    onChangeText(item.name + ' ');
                    inputRef.current?.focus();
                  }}
                  disabled={composerDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.commandSuggestion', { name: item.name })}
                >
                  <Text style={styles.suggestionName}>{item.name}</Text>
                  <Text style={styles.suggestionDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
        {voiceRecorder.isActive ? (
          <View
            pointerEvents="none"
            style={styles.voiceOverlayLayer}
            testID="chat-voice-overlay-layer"
          >
            <VoiceRecorderOverlay
              elapsedMs={voiceRecorder.elapsedMs}
              waveformLevels={voiceRecorder.waveformLevels}
              isCancelling={voiceRecorder.isCancelling}
              isTranscribing={voiceRecorder.isTranscribing}
              title={
                voiceRecorder.isTranscribing
                  ? t('chat.voiceTranscribingTitle')
                  : voiceRecorder.isCancelling
                    ? t('chat.voiceReleaseToCancel')
                    : t('chat.voiceSpeakNow')
              }
              subtitle={
                voiceRecorder.isTranscribing ? t('voice.transcribing') : t('voice.listening')
              }
              primaryHint={
                voiceRecorder.isTranscribing
                  ? t('chat.voicePreparingTranscript')
                  : t('chat.voiceReleaseToSend')
              }
              secondaryHint={
                voiceRecorder.isTranscribing ? undefined : t('chat.voiceSlideUpToCancel')
              }
              pillLabel={
                voiceRecorder.isTranscribing ? t('voice.transcribing') : t('voice.listening')
              }
            />
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.attachBtn, composerDisabled ? styles.attachBtnDisabled : null]}
            onPress={handlePickAttachment}
            disabled={composerDisabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attach')}
          >
            <Paperclip size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {!isEditing ? (
            <Pressable
              style={[
                styles.attachBtn,
                voiceRecorder.isActive ? styles.voiceBtnActive : null,
                isLoading || isInputDisabled || voiceRecorder.isTranscribing
                  ? styles.attachBtnDisabled
                  : null,
              ]}
              disabled={isLoading || isInputDisabled || voiceRecorder.isTranscribing}
              hitSlop={8}
              pressRetentionOffset={CHAT_VOICE_PRESS_RETENTION_OFFSET}
              accessibilityRole="button"
              accessibilityLabel={t('chat.voiceInput')}
              accessibilityHint={t('chat.voiceHoldHint')}
              testID="chat-voice-button"
              {...voiceRecorder.pressableHandlers}
            >
              <Mic
                size={20}
                color={voiceRecorder.isActive ? colors.primary : colors.textSecondary}
              />
            </Pressable>
          ) : null}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={handleTextChange}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={32000}
            textAlignVertical="top"
            editable={!composerDisabled}
            onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
            blurOnSubmit={false}
          />
          {showStopButton ? (
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel={t('chat.stop')}
            >
              <Square size={20} color={colors.danger} fill={colors.danger} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.sendBtn,
                text.trim() || attachments.length > 0 ? styles.sendBtnActive : null,
                isInputDisabled ? styles.sendBtnDisabled : null,
              ]}
              onPress={handleSend}
              disabled={sendDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('chat.send')}
            >
              <Send
                size={20}
                color={text.trim() || attachments.length > 0 ? colors.primary : colors.placeholder}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  },
);

const createStyles = (colors: AppPalette, bottomInset: number) =>
  StyleSheet.create({
    container: {
      position: 'relative',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'visible',
      paddingBottom: Math.max(bottomInset, Platform.OS === 'ios' ? 6 : 8),
      shadowColor: '#000',
      shadowOpacity: Platform.OS === 'ios' ? 0.12 : 0,
      shadowOffset: { width: 0, height: -4 },
      shadowRadius: 12,
      elevation: 10,
    },
    voiceOverlayLayer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: Math.max(bottomInset, Platform.OS === 'ios' ? 6 : 8) + 56,
      zIndex: 3,
      elevation: 3,
    },
    editingBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.border,
    },
    editingLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 6,
    },
    attachBtn: {
      padding: 8,
      justifyContent: 'center',
    },
    attachBtnDisabled: {
      opacity: 0.45,
    },
    voiceBtnActive: {
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
    },
    input: {
      flex: 1,
      backgroundColor: colors.inputBackground,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
      maxHeight: 120,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    sendBtn: {
      padding: 8,
      justifyContent: 'center',
    },
    sendBtnActive: {
      opacity: 1,
    },
    sendBtnDisabled: {
      opacity: 0.45,
    },
    suggestionsContainer: {
      maxHeight: 200,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    voiceErrorBanner: {
      marginHorizontal: 12,
      marginTop: 8,
      borderRadius: 12,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    voiceErrorText: {
      color: colors.danger,
      fontSize: 12,
      fontWeight: '600',
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.subtleBorder || colors.border,
    },
    suggestionName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
      fontFamily: 'monospace',
      minWidth: 80,
    },
    suggestionDesc: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
