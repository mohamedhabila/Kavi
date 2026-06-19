import React from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, Plus, Puzzle, Search } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SkillEntry } from '../../services/skills/types';
import type { ClawHubSkill } from '../../types/clawhub';
import type {
  BrowserProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';
import { BrowseSkillCard, InstalledSkillCard } from './SkillCards';
import { AddSkillModal, SkillSetupModal } from './SkillModals';
import type {
  SkillEligibilityContext,
  SkillsScreenPalette,
  SkillsScreenStyles,
  SkillsScreenTranslation,
} from './skillsScreenTypes';

type AddSkillMode = 'url' | 'manual';
type SecretStatusMap = Record<string, string[]>;

type SkillsScreenViewProps = {
  activeTab: 'installed' | 'browse';
  addMode: AddSkillMode;
  browserProviders: BrowserProviderConfig[];
  closeSetupModal: () => void;
  colors: SkillsScreenPalette;
  eligibilityContext: SkillEligibilityContext;
  entries: SkillEntry[];
  getCompatibilityPillLabel: any;
  handleAddSkill: () => void;
  handleBack: () => void;
  handleDelete: (entry: SkillEntry) => void;
  handleInstallFromHub: (skill: ClawHubSkill) => Promise<void>;
  handleOpenSettings: () => void;
  handleOpenSetup: (entry: SkillEntry) => void;
  handleSaveSetup: () => Promise<void>;
  hubLoading: boolean;
  hubLoadingMore: boolean;
  hubQuery: string;
  hubSkills: ClawHubSkill[];
  installingId: string | null;
  installUrl: string;
  loadHubSkills: (mode?: 'refresh' | 'append') => Promise<void>;
  mcpServers: McpServerConfig[];
  newDescription: string;
  newName: string;
  newRequiredSecrets: string;
  newSystemPrompt: string;
  newToolNames: string;
  secretStatus: SecretStatusMap;
  setActiveTab: React.Dispatch<React.SetStateAction<'installed' | 'browse'>>;
  setAddMode: React.Dispatch<React.SetStateAction<AddSkillMode>>;
  setHubQuery: React.Dispatch<React.SetStateAction<string>>;
  setInstallUrl: React.Dispatch<React.SetStateAction<string>>;
  setNewDescription: React.Dispatch<React.SetStateAction<string>>;
  setNewName: React.Dispatch<React.SetStateAction<string>>;
  setNewRequiredSecrets: React.Dispatch<React.SetStateAction<string>>;
  setNewSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  setNewToolNames: React.Dispatch<React.SetStateAction<string>>;
  setSetupValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
  setupEntry: SkillEntry | null;
  setupLoading: boolean;
  setupSaving: boolean;
  setupValues: Record<string, string>;
  showAddModal: boolean;
  sshTargets: SshTargetConfig[];
  styles: SkillsScreenStyles;
  t: SkillsScreenTranslation;
  toggleEntry: (id: string) => void;
  workspaceTargets: WorkspaceTargetConfig[];
};

export function SkillsScreenView({
  activeTab,
  addMode,
  browserProviders,
  closeSetupModal,
  colors,
  eligibilityContext,
  entries,
  getCompatibilityPillLabel,
  handleAddSkill,
  handleBack,
  handleDelete,
  handleInstallFromHub,
  handleOpenSettings,
  handleOpenSetup,
  handleSaveSetup,
  hubLoading,
  hubLoadingMore,
  hubQuery,
  hubSkills,
  installingId,
  installUrl,
  loadHubSkills,
  mcpServers,
  newDescription,
  newName,
  newRequiredSecrets,
  newSystemPrompt,
  newToolNames,
  secretStatus,
  setActiveTab,
  setAddMode,
  setHubQuery,
  setInstallUrl,
  setNewDescription,
  setNewName,
  setNewRequiredSecrets,
  setNewSystemPrompt,
  setNewToolNames,
  setSetupValues,
  setShowAddModal,
  setupEntry,
  setupLoading,
  setupSaving,
  setupValues,
  showAddModal,
  sshTargets,
  styles,
  t,
  toggleEntry,
  workspaceTargets,
}: SkillsScreenViewProps) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('skills.title')}</Text>
        <TouchableOpacity
          onPress={() => setShowAddModal(true)}
          accessibilityRole="button"
          accessibilityLabel={t('skills.addSkill')}
        >
          <Plus size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'installed' && styles.tabBtnActive]}
          onPress={() => setActiveTab('installed')}
        >
          <Text style={[styles.tabText, activeTab === 'installed' && styles.tabTextActive]}>
            {t('skills.installed')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'browse' && styles.tabBtnActive]}
          onPress={() => {
            setActiveTab('browse');
            if (hubSkills.length === 0) {
              void loadHubSkills('refresh');
            }
          }}
        >
          <Text style={[styles.tabText, activeTab === 'browse' && styles.tabTextActive]}>
            {t('skills.browse')}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'installed' ? (
        <FlatList
          data={entries}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <InstalledSkillCard
              browserProviders={browserProviders}
              colors={colors}
              eligibilityContext={eligibilityContext}
              getCompatibilityPillLabel={getCompatibilityPillLabel}
              item={item}
              mcpServers={mcpServers}
              onDelete={handleDelete}
              onOpenSetup={handleOpenSetup}
              secretStatus={secretStatus}
              sshTargets={sshTargets}
              styles={styles}
              t={t}
              toggleEntry={toggleEntry}
              workspaceTargets={workspaceTargets}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Puzzle size={40} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{t('skills.noSkills')}</Text>
              <Text style={styles.emptyText}>{t('skills.noSkillsHint')}</Text>
            </View>
          }
        />
      ) : (
        <View style={styles.browseContainer}>
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
              value={hubQuery}
              onChangeText={setHubQuery}
              placeholder={t('skills.searchPlaceholder')}
              placeholderTextColor={colors.placeholder}
              onSubmitEditing={() => {
                void loadHubSkills('refresh');
              }}
              returnKeyType="search"
            />
            <TouchableOpacity
              style={styles.searchBtn}
              onPress={() => {
                void loadHubSkills('refresh');
              }}
              accessibilityRole="button"
              accessibilityLabel={t('common.search')}
            >
              <Search size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {hubLoading ? (
            <ActivityIndicator style={{ padding: 40 }} color={colors.primary} />
          ) : (
            <FlatList
              data={hubSkills}
              keyExtractor={(skill) => skill.id}
              contentContainerStyle={styles.list}
              onEndReached={() => {
                void loadHubSkills('append');
              }}
              onEndReachedThreshold={0.6}
              ListHeaderComponent={
                <View style={styles.browseIntroCard}>
                  <Text style={styles.browseIntroTitle}>
                    {hubQuery.trim() ? t('skills.browse') : t('skills.popular')}
                  </Text>
                  <Text style={styles.browseIntroText}>{t('skills.browseHint')}</Text>
                </View>
              }
              ListFooterComponent={
                hubLoadingMore ? (
                  <View style={styles.listFooter}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <BrowseSkillCard
                  colors={colors}
                  entries={entries}
                  installingId={installingId}
                  onInstallFromHub={handleInstallFromHub}
                  skill={item}
                  styles={styles}
                  t={t}
                />
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Search size={40} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>{t('skills.browse')}</Text>
                  <Text style={styles.emptyText}>
                    {hubQuery.trim() ? t('skills.noBrowseResults') : t('skills.browseHint')}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      )}

      <AddSkillModal
        addMode={addMode}
        colors={colors}
        handleAddSkill={handleAddSkill}
        installingId={installingId}
        installUrl={installUrl}
        newDescription={newDescription}
        newName={newName}
        newRequiredSecrets={newRequiredSecrets}
        newSystemPrompt={newSystemPrompt}
        newToolNames={newToolNames}
        setAddMode={setAddMode}
        setInstallUrl={setInstallUrl}
        setNewDescription={setNewDescription}
        setNewName={setNewName}
        setNewRequiredSecrets={setNewRequiredSecrets}
        setNewSystemPrompt={setNewSystemPrompt}
        setNewToolNames={setNewToolNames}
        setShowAddModal={setShowAddModal}
        showAddModal={showAddModal}
        styles={styles}
        t={t}
      />

      <SkillSetupModal
        closeSetupModal={closeSetupModal}
        colors={colors}
        handleOpenSettings={handleOpenSettings}
        handleSaveSetup={handleSaveSetup}
        setSetupValues={setSetupValues}
        setupEntry={setupEntry}
        setupLoading={setupLoading}
        setupSaving={setupSaving}
        setupValues={setupValues}
        styles={styles}
        t={t}
      />
    </SafeAreaView>
  );
}
