import React from 'react';
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';

import { AppIconButton } from '../../components/navigation/AppIconButton';
import { AppTabButton } from '../../components/navigation/AppTabButton';
import { getSkillRequiredSecrets, getSkillSecretField } from '../../services/skills/manifest';
import type { SkillEntry } from '../../services/skills/types';
import type {
  SkillsScreenPalette,
  SkillsScreenStyles,
  SkillsScreenTranslation,
} from './skillsScreenTypes';

type AddSkillMode = 'url' | 'manual';

type AddSkillModalProps = {
  addMode: AddSkillMode;
  colors: SkillsScreenPalette;
  handleAddSkill: () => void;
  installingId: string | null;
  installUrl: string;
  newDescription: string;
  newName: string;
  newRequiredSecrets: string;
  newSystemPrompt: string;
  newToolNames: string;
  setAddMode: React.Dispatch<React.SetStateAction<AddSkillMode>>;
  setInstallUrl: React.Dispatch<React.SetStateAction<string>>;
  setNewDescription: React.Dispatch<React.SetStateAction<string>>;
  setNewName: React.Dispatch<React.SetStateAction<string>>;
  setNewRequiredSecrets: React.Dispatch<React.SetStateAction<string>>;
  setNewSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  setNewToolNames: React.Dispatch<React.SetStateAction<string>>;
  setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
  showAddModal: boolean;
  styles: SkillsScreenStyles;
  t: SkillsScreenTranslation;
};

export function AddSkillModal({
  addMode,
  colors,
  handleAddSkill,
  installingId,
  installUrl,
  newDescription,
  newName,
  newRequiredSecrets,
  newSystemPrompt,
  newToolNames,
  setAddMode,
  setInstallUrl,
  setNewDescription,
  setNewName,
  setNewRequiredSecrets,
  setNewSystemPrompt,
  setNewToolNames,
  setShowAddModal,
  showAddModal,
  styles,
  t,
}: AddSkillModalProps) {
  return (
    <Modal
      visible={showAddModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowAddModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View accessibilityViewIsModal style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('skills.addSkill')}</Text>
            <AppIconButton
              onPress={() => setShowAddModal(false)}
              label={t('common.close')}
              testID="skills-add-close"
            >
              <X size={20} color={colors.textSecondary} />
            </AppIconButton>
          </View>
          <Text style={styles.modalHelp}>{t('skills.addSkillHint')}</Text>
          <View style={styles.modeRow}>
            <AppTabButton
              label={t('skills.installFromUrl')}
              selected={addMode === 'url'}
              style={[styles.modeBtn, addMode === 'url' && styles.modeBtnActive]}
              onPress={() => setAddMode('url')}
              testID="skills-add-mode-url"
            >
              <Text style={[styles.modeBtnText, addMode === 'url' && styles.modeBtnTextActive]}>
                {t('skills.installFromUrl')}
              </Text>
            </AppTabButton>
            <AppTabButton
              label={t('skills.createManually')}
              selected={addMode === 'manual'}
              style={[styles.modeBtn, addMode === 'manual' && styles.modeBtnActive]}
              onPress={() => setAddMode('manual')}
              testID="skills-add-mode-manual"
            >
              <Text style={[styles.modeBtnText, addMode === 'manual' && styles.modeBtnTextActive]}>
                {t('skills.createManually')}
              </Text>
            </AppTabButton>
          </View>

          {addMode === 'url' ? (
            <>
              <Text style={styles.modalCaption}>{t('skills.installUrlHint')}</Text>
              <TextInput
                accessibilityLabel={t('skills.urlPlaceholder')}
                style={styles.modalInput}
                value={installUrl}
                onChangeText={setInstallUrl}
                placeholder={t('skills.urlPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                keyboardType="url"
              />
            </>
          ) : (
            <>
              <Text style={styles.modalCaption}>{t('skills.createManualHint')}</Text>
              <TextInput
                accessibilityLabel={t('skills.skillNamePlaceholder')}
                style={styles.modalInput}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('skills.skillNamePlaceholder')}
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                accessibilityLabel={t('skills.descriptionPlaceholder')}
                style={[styles.modalInput, { height: 80 }]}
                value={newDescription}
                onChangeText={setNewDescription}
                placeholder={t('skills.descriptionPlaceholder')}
                placeholderTextColor={colors.placeholder}
                multiline
              />
              <Text style={styles.modalCaption}>{t('skills.systemPrompt')}</Text>
              <TextInput
                accessibilityLabel={t('skills.systemPrompt')}
                style={[styles.modalInput, { height: 96 }]}
                value={newSystemPrompt}
                onChangeText={setNewSystemPrompt}
                placeholder={t('skills.systemPromptPlaceholder')}
                placeholderTextColor={colors.placeholder}
                multiline
              />
              <Text style={styles.modalCaption}>{t('skills.toolNames')}</Text>
              <TextInput
                accessibilityLabel={t('skills.toolNames')}
                style={styles.modalInput}
                value={newToolNames}
                onChangeText={setNewToolNames}
                placeholder={t('skills.toolNamesPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
              />
              <Text style={styles.modalCaption}>{t('skills.requiredSecretsLabel')}</Text>
              <TextInput
                accessibilityLabel={t('skills.requiredSecretsLabel')}
                style={styles.modalInput}
                value={newRequiredSecrets}
                onChangeText={setNewRequiredSecrets}
                placeholder={t('skills.requiredSecretsPlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="characters"
              />
            </>
          )}
          <TouchableOpacity
            accessibilityLabel={addMode === 'url' ? t('skills.installUrl') : t('skills.addSkill')}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(installingId) }}
            disabled={Boolean(installingId)}
            style={[styles.modalButton, installingId ? styles.disabledButton : null]}
            onPress={handleAddSkill}
            testID="skills-add-submit"
          >
            {installingId === installUrl.trim() ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.modalButtonText}>
                {addMode === 'url' ? t('skills.installUrl') : t('skills.addSkill')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

type SkillSetupModalProps = {
  closeSetupModal: () => void;
  colors: SkillsScreenPalette;
  handleOpenSettings: () => void;
  handleSaveSetup: () => Promise<void>;
  setSetupValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setupEntry: SkillEntry | null;
  setupLoading: boolean;
  setupSaving: boolean;
  setupValues: Record<string, string>;
  styles: SkillsScreenStyles;
  t: SkillsScreenTranslation;
};

export function SkillSetupModal({
  closeSetupModal,
  colors,
  handleOpenSettings,
  handleSaveSetup,
  setSetupValues,
  setupEntry,
  setupLoading,
  setupSaving,
  setupValues,
  styles,
  t,
}: SkillSetupModalProps) {
  return (
    <Modal
      visible={Boolean(setupEntry)}
      transparent
      animationType="slide"
      onRequestClose={closeSetupModal}
    >
      <View style={styles.modalOverlay}>
        <View accessibilityViewIsModal style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {setupEntry ? t('skills.setupSkill', { name: setupEntry.metadata.name }) : ''}
            </Text>
            <AppIconButton
              onPress={closeSetupModal}
              label={t('common.close')}
              testID="skills-setup-close"
            >
              <X size={20} color={colors.textSecondary} />
            </AppIconButton>
          </View>

          {setupEntry ? (
            <>
              <Text style={styles.modalHelp}>{t('skills.setupSkillHint')}</Text>
              {setupLoading ? (
                <ActivityIndicator style={styles.setupLoader} color={colors.primary} />
              ) : (
                <>
                  {getSkillRequiredSecrets(setupEntry.metadata).map((secretName) => {
                    const field = getSkillSecretField(secretName);
                    return (
                      <View key={secretName}>
                        <Text style={styles.secretLabel}>{field.label}</Text>
                        <Text style={styles.secretHint}>{field.hint}</Text>
                        <TextInput
                          accessibilityLabel={field.label}
                          style={styles.modalInput}
                          value={setupValues[secretName] || ''}
                          onChangeText={(value) =>
                            setSetupValues((current) => ({
                              ...current,
                              [secretName]: value,
                            }))
                          }
                          placeholder={field.placeholder}
                          placeholderTextColor={colors.placeholder}
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry
                        />
                      </View>
                    );
                  })}

                  <View style={styles.setupFooter}>
                    <TouchableOpacity
                      accessibilityLabel={t('skills.openSettings')}
                      accessibilityRole="button"
                      onPress={handleOpenSettings}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>{t('skills.openSettings')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      accessibilityLabel={t('skills.configure')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: setupSaving }}
                      disabled={setupSaving}
                      style={[styles.modalButton, setupSaving ? styles.disabledButton : null]}
                      onPress={() => {
                        void handleSaveSetup();
                      }}
                      testID="skills-setup-save"
                    >
                      {setupSaving ? (
                        <ActivityIndicator color={colors.onPrimary} />
                      ) : (
                        <Text style={styles.modalButtonText}>{t('skills.configure')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
