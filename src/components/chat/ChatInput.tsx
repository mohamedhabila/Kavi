// ---------------------------------------------------------------------------
// Kavi — ChatInput Component
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Send, Square, Paperclip, X, Mic, MoreHorizontal } from 'lucide-react-native';
import { Attachment } from '../../types/attachment';
import { useAppTheme } from '../../theme/useAppTheme';
import { AttachmentPreview } from './AttachmentPreview';
import { useTranslation } from '../../i18n/useTranslation';
import { getAllCommands } from '../../services/commands/builtins';
import { useChatVoiceRecorder } from './useChatVoiceRecorder';
import { CHAT_VOICE_PRESS_RETENTION_OFFSET } from './chatVoiceConstants';
import { createChatInputStyles } from './ChatInput.styles';
import { ChatInputCommandSuggestions } from './ChatInputCommandSuggestions';
import { ChatInputVoiceOverlayLayer } from './ChatInputVoiceOverlayLayer';
import { useChatInputAttachments } from './useChatInputAttachments';
import {
  ChatInputExactTextIndicator,
  ChatInputOptionsSheet,
} from './ChatInputOptionsSheet';

interface ChatInputProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  isLoading: boolean;
  isInputDisabled?: boolean;
  exactText: boolean;
  text: string;
  onChangeExactText: (exactText: boolean) => void;
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
    exactText,
    text,
    onChangeExactText,
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
    const styles = useMemo(() => createChatInputStyles(colors, bottomInset), [bottomInset, colors]);
    const inputRef = useRef<TextInput>(null);
    const [optionsVisible, setOptionsVisible] = useState(false);

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
      if (!text.trim() && attachments.length === 0) return;
      voiceRecorder.clearError();
      onSend(text, attachments.length > 0 ? attachments : undefined);
    }, [attachments, onSend, text, voiceRecorder]);

    const { handlePickAttachment, removeAttachment } = useChatInputAttachments({
      attachments,
      clearVoiceError: voiceRecorder.clearError,
      isInputDisabled,
      isVoiceActive: voiceRecorder.isActive,
      onChangeAttachments,
      supportsVision,
      t,
    });

    const handleTextChange = useCallback(
      (value: string) => {
        if (voiceRecorder.errorMessage) {
          voiceRecorder.clearError();
        }
        onChangeText(value);
      },
      [onChangeText, voiceRecorder],
    );
    const handleCommandSuggestionSelect = useCallback(
      (commandName: string) => {
        onChangeText(`${commandName} `);
        inputRef.current?.focus();
      },
      [onChangeText],
    );

    const composerDisabled = isInputDisabled || voiceRecorder.isActive;
    const sendDisabled = composerDisabled || (!text.trim() && attachments.length === 0);
    const showStopButton = isLoading && !text.trim() && attachments.length === 0;

    useEffect(() => {
      if (composerDisabled) {
        setOptionsVisible(false);
      }
    }, [composerDisabled]);

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
        {exactText ? (
          <ChatInputExactTextIndicator
            colors={colors}
            onDisable={() => onChangeExactText(false)}
            styles={styles}
            t={t}
          />
        ) : null}
        <ChatInputCommandSuggestions
          disabled={composerDisabled}
          onSelect={handleCommandSuggestionSelect}
          styles={styles}
          suggestions={commandSuggestions}
          t={t}
        />
        <ChatInputVoiceOverlayLayer
          elapsedMs={voiceRecorder.elapsedMs}
          isActive={voiceRecorder.isActive}
          isCancelling={voiceRecorder.isCancelling}
          isTranscribing={voiceRecorder.isTranscribing}
          styles={styles}
          t={t}
          waveformLevels={voiceRecorder.waveformLevels}
        />
        <View style={styles.inputRow} testID="chat-composer-row">
          <TouchableOpacity
            style={[styles.attachBtn, composerDisabled ? styles.attachBtnDisabled : null]}
            onPress={handlePickAttachment}
            disabled={composerDisabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attach')}
            accessibilityState={{ disabled: composerDisabled }}
            testID="chat-attach-button"
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
              accessibilityState={{
                disabled: isLoading || isInputDisabled || voiceRecorder.isTranscribing,
              }}
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
            testID="chat-composer-input"
            value={text}
            onChangeText={handleTextChange}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize={exactText ? 'none' : 'sentences'}
            autoComplete="off"
            autoCorrect={!exactText}
            keyboardType={
              exactText
                ? Platform.OS === 'ios'
                  ? 'ascii-capable'
                  : Platform.OS === 'android'
                    ? 'visible-password'
                    : 'default'
                : 'default'
            }
            multiline
            smartInsertDelete={!exactText}
            spellCheck={!exactText}
            textAlignVertical="top"
            textContentType="none"
            editable={!composerDisabled}
            onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            accessibilityLabel={t('chat.openInputOptions')}
            accessibilityRole="button"
            accessibilityState={{ disabled: composerDisabled, expanded: optionsVisible }}
            disabled={composerDisabled}
            hitSlop={8}
            onPress={() => setOptionsVisible(true)}
            style={[styles.attachBtn, composerDisabled ? styles.attachBtnDisabled : null]}
            testID="chat-open-input-options"
          >
            <MoreHorizontal size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {showStopButton ? (
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel={t('chat.stop')}
              testID="chat-stop-button"
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
              accessibilityState={{ disabled: sendDisabled }}
              testID="chat-send-button"
            >
              <Send
                size={20}
                color={text.trim() || attachments.length > 0 ? colors.primary : colors.placeholder}
              />
            </TouchableOpacity>
          )}
        </View>
        <ChatInputOptionsSheet
          colors={colors}
          exactText={exactText}
          onChangeExactText={onChangeExactText}
          onClose={() => setOptionsVisible(false)}
          styles={styles}
          t={t}
          visible={optionsVisible}
        />
      </View>
    );
  },
);
