import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type {
  ExpoActionOverrides,
  ExpoActionType,
  ExpoWorkflowPromptState,
} from '../../features/expo/projectActions';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkExpoWorkflowPromptModalProps = {
  styles: StyleMap;
  t: TranslationFn;
  colors: { textTertiary: string };
  expoWorkflowPrompt: ExpoWorkflowPromptState;
  setExpoWorkflowPrompt: React.Dispatch<React.SetStateAction<ExpoWorkflowPromptState>>;
  getExpoActionLabel: (
    action: ExpoActionType,
    overrides?: ExpoActionOverrides,
  ) => string;
  handleConfirmExpoWorkflowPrompt: () => void;
};

export const RemoteWorkExpoWorkflowPromptModal: React.FC<
  RemoteWorkExpoWorkflowPromptModalProps
> = ({
  styles,
  t,
  colors,
  expoWorkflowPrompt,
  setExpoWorkflowPrompt,
  getExpoActionLabel,
  handleConfirmExpoWorkflowPrompt,
}) => {
  return (
    <Modal
      visible={Boolean(expoWorkflowPrompt)}
      transparent
      animationType="fade"
      onRequestClose={() => setExpoWorkflowPrompt(null)}
    >
      <View style={styles.promptBackdrop}>
        <View style={styles.promptCard}>
          <Text style={styles.promptTitle}>{t('remoteWork.expoWorkflowBranchPromptTitle')}</Text>
          <Text style={styles.promptBody}>
            {t('remoteWork.expoWorkflowBranchPromptBody', {
              actionLabel: expoWorkflowPrompt
                ? getExpoActionLabel(expoWorkflowPrompt.action, expoWorkflowPrompt.overrides)
                : t('remoteWork.expoBuildAndroid'),
            })}
          </Text>
          <Text style={styles.detailLabel}>{t('remoteWork.expoWorkflowBranchLabel')}</Text>
          <TextInput
            value={expoWorkflowPrompt?.workflowRef || ''}
            onChangeText={(value) =>
              setExpoWorkflowPrompt((current) =>
                current ? { ...current, workflowRef: value } : current,
              )
            }
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('remoteWork.expoWorkflowBranchPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            style={styles.promptInput}
          />
          <View style={styles.promptActions}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setExpoWorkflowPrompt(null)}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleConfirmExpoWorkflowPrompt}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.expoWorkflowRunAction')}
            >
              <Text style={styles.primaryBtnText}>{t('remoteWork.expoWorkflowRunAction')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
