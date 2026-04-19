// ---------------------------------------------------------------------------
// Kavi — Skills Manager Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Download, Plus, Puzzle, Search, Trash2, Wrench, X } from 'lucide-react-native';
import { useSkillsStore } from '../services/skills/manager';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  getSkillCompatibility,
  getSkillRequiredSecrets,
  getSkillSecretField,
  getSkillSurfaceLabel,
} from '../services/skills/manifest';
import { buildSkillEligibilityContext } from '../services/skills/eligibility';
import { resolveSkillExecutionPlan } from '../services/skills/routing';
import { deleteSecure, getSecure, saveSecure } from '../services/storage/SecureStorage';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import { generateId } from '../utils/id';
import {
  listClawHubSkills,
  searchClawHub,
  installSkillFromHub,
  installSkillFromUrl,
} from '../services/clawhub/registryClient';
import type { SkillEntry } from '../services/skills/types';
import type { ClawHubSkill } from '../types';
import { useBackToChat } from '../navigation/useBackToChat';

type AddSkillMode = 'url' | 'manual';
const BROWSE_PAGE_SIZE = 20;

type SecretStatusMap = Record<string, string[]>;

function normalizeCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeHubSkills(current: ClawHubSkill[], incoming: ClawHubSkill[]): ClawHubSkill[] {
  const merged = new Map<string, ClawHubSkill>();
  for (const skill of current) {
    merged.set(skill.id, skill);
  }
  for (const skill of incoming) {
    if (!merged.has(skill.id)) {
      merged.set(skill.id, skill);
    }
  }
  return Array.from(merged.values());
}

export const SkillsScreen: React.FC = () => {
  const navigation = useNavigation();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const entries = useSkillsStore((s) => s.entries);
  const toggleEntry = useSkillsStore((s) => s.toggleEntry);
  const removeEntry = useSkillsStore((s) => s.removeEntry);
  const addEntry = useSkillsStore((s) => s.addEntry);
  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const sshTargets = useSettingsStore((s) => s.sshTargets || []);
  const workspaceTargets = useSettingsStore((s) => s.workspaceTargets || []);
  const browserProviders = useSettingsStore((s) => s.browserProviders || []);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<AddSkillMode>('url');
  const [installUrl, setInstallUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSystemPrompt, setNewSystemPrompt] = useState('');
  const [newToolNames, setNewToolNames] = useState('');
  const [newRequiredSecrets, setNewRequiredSecrets] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [hubQuery, setHubQuery] = useState('');
  const [hubSkills, setHubSkills] = useState<ClawHubSkill[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubLoadingMore, setHubLoadingMore] = useState(false);
  const [hubNextCursor, setHubNextCursor] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatusMap>({});
  const [setupEntry, setSetupEntry] = useState<SkillEntry | null>(null);
  const [setupValues, setSetupValues] = useState<Record<string, string>>({});
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const hubRequestInFlightRef = useRef(false);
  const hubQueuedRefreshRef = useRef(false);
  const hubQueryRef = useRef(hubQuery);
  const hubNextCursorRef = useRef(hubNextCursor);

  const eligibilityContext = useMemo(
    () =>
      buildSkillEligibilityContext({
        mcpServers,
        sshTargets,
        workspaceTargets,
        browserProviders,
      }),
    [browserProviders, mcpServers, sshTargets, workspaceTargets],
  );

  hubQueryRef.current = hubQuery;
  hubNextCursorRef.current = hubNextCursor;

  const loadSecretStatus = useCallback(async (skills: SkillEntry[]) => {
    const next: SecretStatusMap = {};

    await Promise.all(
      skills.map(async (entry) => {
        const requiredSecrets = getSkillRequiredSecrets(entry.metadata);
        if (requiredSecrets.length === 0) {
          return;
        }

        const configuredSecrets: string[] = [];
        for (const secretName of requiredSecrets) {
          const field = getSkillSecretField(secretName);
          const currentValue = await getSecure(field.storageKey);
          if (currentValue) {
            configuredSecrets.push(secretName);
          }
        }

        next[entry.id] = configuredSecrets;
      }),
    );

    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const skillsNeedingSetup = entries.filter(
      (entry) => getSkillRequiredSecrets(entry.metadata).length > 0,
    );

    if (skillsNeedingSetup.length === 0) {
      setSecretStatus({});
      return () => {
        cancelled = true;
      };
    }

    void loadSecretStatus(skillsNeedingSetup).then((next) => {
      if (!cancelled && next) {
        setSecretStatus(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [entries, loadSecretStatus]);

  const loadHubSkills = useCallback(async (mode: 'refresh' | 'append' = 'refresh') => {
    const query = hubQueryRef.current.trim();
    const isSearch = !!query;

    if (hubRequestInFlightRef.current) {
      if (mode === 'refresh') {
        hubQueuedRefreshRef.current = true;
      }
      return;
    }

    if (mode === 'append' && (isSearch || !hubNextCursorRef.current)) {
      return;
    }

    hubRequestInFlightRef.current = true;
    if (mode === 'append') {
      setHubLoadingMore(true);
    } else {
      setHubLoading(true);
    }

    try {
      if (isSearch) {
        const result = await searchClawHub(query);
        setHubSkills(result.skills);
        setHubNextCursor(null);
      } else {
        const result = await listClawHubSkills({
          limit: BROWSE_PAGE_SIZE,
          cursor: mode === 'append' ? hubNextCursorRef.current : null,
          sort: 'downloads',
        });

        setHubSkills((current) =>
          mode === 'append' ? mergeHubSkills(current, result.skills) : result.skills,
        );
        setHubNextCursor(result.nextCursor);
      }
    } catch {
      if (mode !== 'append') {
        setHubSkills([]);
      }
      setHubNextCursor(null);
    } finally {
      hubRequestInFlightRef.current = false;
      if (mode === 'append') {
        setHubLoadingMore(false);
      } else {
        setHubLoading(false);
      }

      if (hubQueuedRefreshRef.current) {
        hubQueuedRefreshRef.current = false;
        void loadHubSkills('refresh');
      }
    }
  }, []);

  const handleInstallFromHub = useCallback(
    async (skill: ClawHubSkill) => {
      setInstallingId(skill.id);
      try {
        const result = await installSkillFromHub(skill);
        if (result.success) {
          const installedSkill = result.skillEntry;
          const requiredSecrets = installedSkill
            ? getSkillRequiredSecrets(installedSkill.metadata)
            : [];
          if (installedSkill && requiredSecrets.length > 0) {
            setActiveTab('installed');
            setSetupEntry(installedSkill);
          } else {
            Alert.alert(t('skills.skillCreated'), skill.name);
          }
        } else {
          const alertTitle = result.error?.toLowerCase().includes('compatible')
            ? t('skills.installBlocked')
            : t('common.error');
          Alert.alert(alertTitle, result.error || t('skills.installFailed'));
        }
      } catch (err: unknown) {
        Alert.alert(t('common.error'), err instanceof Error ? err.message : String(err));
      }
      setInstallingId(null);
    },
    [t],
  );

  const handleAddSkill = useCallback(() => {
    if (addMode === 'url') {
      const trimmedUrl = installUrl.trim();
      if (!trimmedUrl) {
        Alert.alert(t('common.error'), t('skills.invalidUrl'));
        return;
      }

      try {
        const parsed = new URL(trimmedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('invalid');
        }
      } catch {
        Alert.alert(t('common.error'), t('skills.invalidUrl'));
        return;
      }

      setInstallingId(trimmedUrl);
      installSkillFromUrl(trimmedUrl)
        .then((result) => {
          if (result.success) {
            setInstallUrl('');
            setShowAddModal(false);

            const installedSkill = result.skillEntry;
            const requiredSecrets = installedSkill
              ? getSkillRequiredSecrets(installedSkill.metadata)
              : [];
            if (installedSkill && requiredSecrets.length > 0) {
              setActiveTab('installed');
              setSetupEntry(installedSkill);
            } else {
              Alert.alert(t('skills.skillCreated'), result.skillEntry?.metadata.name || trimmedUrl);
            }
          } else {
            const alertTitle = result.error?.toLowerCase().includes('compatible')
              ? t('skills.installBlocked')
              : t('common.error');
            Alert.alert(alertTitle, result.error || t('skills.installFailed'));
          }
        })
        .catch((err: any) => {
          Alert.alert(t('common.error'), err.message);
        })
        .finally(() => setInstallingId(null));
      return;
    }

    const name = newName.trim();
    if (!name) {
      Alert.alert(t('common.error'), t('skills.nameRequired'));
      return;
    }
    const entry: SkillEntry = {
      id: generateId(),
      metadata: {
        name,
        description: newDescription.trim(),
        version: '1.0.0',
        requiredSecrets: normalizeCommaSeparatedList(newRequiredSecrets),
        tools: normalizeCommaSeparatedList(newToolNames),
      },
      enabled: true,
      installedAt: Date.now(),
      source: { source: 'manual' },
      systemPrompt: newSystemPrompt.trim() || undefined,
    };
    addEntry(entry);
    setInstallUrl('');
    setNewName('');
    setNewDescription('');
    setNewSystemPrompt('');
    setNewToolNames('');
    setNewRequiredSecrets('');
    setShowAddModal(false);
  }, [
    addMode,
    addEntry,
    installUrl,
    newDescription,
    newName,
    newRequiredSecrets,
    newSystemPrompt,
    newToolNames,
    t,
  ]);

  const closeSetupModal = useCallback(() => {
    setSetupEntry(null);
    setSetupValues({});
    setSetupLoading(false);
    setSetupSaving(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!setupEntry) {
      return () => {
        cancelled = true;
      };
    }

    const requiredSecrets = getSkillRequiredSecrets(setupEntry.metadata);
    if (requiredSecrets.length === 0) {
      setSetupLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSetupLoading(true);
    void Promise.all(
      requiredSecrets.map(async (secretName) => {
        const field = getSkillSecretField(secretName);
        const storedValue = await getSecure(field.storageKey);
        return [secretName, storedValue || ''] as const;
      }),
    ).then((pairs) => {
      if (cancelled) {
        return;
      }

      setSetupValues(Object.fromEntries(pairs));
      setSetupLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [setupEntry]);

  const handleSaveSetup = useCallback(async () => {
    if (!setupEntry) {
      return;
    }

    const requiredSecrets = getSkillRequiredSecrets(setupEntry.metadata);
    if (requiredSecrets.length === 0) {
      closeSetupModal();
      return;
    }

    setSetupSaving(true);
    try {
      for (const secretName of requiredSecrets) {
        const field = getSkillSecretField(secretName);
        const value = (setupValues[secretName] || '').trim();

        if (value) {
          await saveSecure(field.storageKey, value);
        } else {
          await deleteSecure(field.storageKey);
        }
      }

      setSecretStatus((current) => ({
        ...current,
        [setupEntry.id]: requiredSecrets.filter((secretName) =>
          Boolean((setupValues[secretName] || '').trim()),
        ),
      }));
      closeSetupModal();
    } catch {
      Alert.alert(t('common.error'), t('skills.secretSaveFailed'));
    } finally {
      setSetupSaving(false);
    }
  }, [closeSetupModal, setupEntry, setupValues, t]);

  const handleOpenSetup = useCallback((entry: SkillEntry) => {
    setSetupValues({});
    setSetupLoading(true);
    setSetupEntry(entry);
  }, []);

  const handleDelete = (entry: SkillEntry) => {
    Alert.alert(
      t('skills.removeSkill'),
      t('skills.uninstallConfirm', { name: entry.metadata.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.remove'), style: 'destructive', onPress: () => removeEntry(entry.id) },
      ],
    );
  };

  const getCompatibilityPillLabel = useCallback(
    (status: ReturnType<typeof getSkillCompatibility>['status']) => {
      switch (status) {
        case 'setup-required':
          return t('skills.setupRequired');
        case 'requires-external-surface':
          return t('skills.externalSurfaceRequired');
        case 'unsupported':
          return t('skills.incompatible');
        default:
          return t('skills.runsHere');
      }
    },
    [t],
  );

  const renderSkill = ({ item }: { item: SkillEntry }) => {
    const requiredSecrets = getSkillRequiredSecrets(item.metadata);
    const configuredSecrets = secretStatus[item.id] || [];
    const compatibility = getSkillCompatibility(item.metadata, {
      ...eligibilityContext,
      hasSecret: (secretName) => configuredSecrets.includes(secretName),
    });
    const executionPlan = resolveSkillExecutionPlan(item.metadata, {
      mcpServers,
      sshTargets,
      workspaceTargets,
      browserProviders,
    });
    const configuredCount = configuredSecrets.length;
    const needsSetup = requiredSecrets.length > 0;
    const setupComplete = needsSetup && configuredCount >= requiredSecrets.length;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Puzzle size={18} color={item.enabled ? colors.primary : colors.textTertiary} />
          <View style={styles.cardTitleSection}>
            <Text style={styles.cardTitle}>{item.metadata.name}</Text>
            {item.metadata.version && (
              <Text style={styles.version}>
                {t('common.versionShort', { version: item.metadata.version })}
              </Text>
            )}
          </View>
          <Switch
            value={item.enabled}
            onValueChange={() => toggleEntry(item.id)}
            trackColor={{ true: colors.primary }}
          />
        </View>

        {item.metadata.description && (
          <Text style={styles.description} numberOfLines={2}>
            {item.metadata.description}
          </Text>
        )}

        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {getCompatibilityPillLabel(compatibility.status)}
          </Text>
        </View>

        {compatibility.suggestedSurfaces.length > 0 && (
          <View style={styles.surfaceRow}>
            <Text style={styles.surfaceLabel}>{t('skills.bestRoute')}</Text>
            <View style={styles.surfaceChips}>
              {compatibility.suggestedSurfaces.map((surface) => (
                <View key={`${item.id}-${surface}`} style={styles.surfaceChip}>
                  <Text style={styles.surfaceChipText}>{getSkillSurfaceLabel(surface)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {executionPlan.selectedRoute ? (
          <Text style={styles.helperText}>
            {`${getSkillSurfaceLabel(executionPlan.selectedRoute.surface)} -> ${executionPlan.selectedRoute.targetName || executionPlan.selectedRoute.detail}`}
          </Text>
        ) : null}

        {needsSetup && (
          <View style={styles.setupRow}>
            <Text style={styles.setupText}>
              {setupComplete
                ? t('skills.setupComplete')
                : t('skills.setupStatus', {
                    configured: String(configuredCount),
                    total: String(requiredSecrets.length),
                  })}
            </Text>
            <TouchableOpacity
              style={styles.setupButton}
              onPress={() => handleOpenSetup(item)}
              accessibilityRole="button"
              accessibilityLabel={t('skills.configure')}
            >
              <Text style={styles.setupButtonText}>{t('skills.configure')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {compatibility.reason && <Text style={styles.helperText}>{compatibility.reason}</Text>}

        {item.metadata.tools && item.metadata.tools.length > 0 && (
          <View style={styles.toolsRow}>
            <Wrench size={12} color={colors.textTertiary} />
            <Text style={styles.toolsText}>
              {item.metadata.tools.length === 1
                ? t('skills.toolCountOne')
                : t('skills.toolCount', { count: String(item.metadata.tools.length) })}
            </Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.source}>{item.source?.source || t('skills.builtIn')}</Text>
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete skill ${item.metadata?.name || item.id}`}
          >
            <Trash2 size={16} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

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

      {/* Tab selector */}
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
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          renderItem={renderSkill}
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
              keyExtractor={(s) => s.id}
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
              renderItem={({ item: skill }) => {
                const isInstalled = entries.some((e) => e.source?.id === skill.id);
                return (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Puzzle size={18} color={colors.primary} />
                      <View style={styles.cardTitleSection}>
                        <Text style={styles.cardTitle}>{skill.name}</Text>
                        {skill.author ? (
                          <Text style={styles.version}>
                            {t('skills.byAuthor', { author: skill.author })}
                          </Text>
                        ) : null}
                      </View>
                      {isInstalled ? (
                        <Text style={[styles.version, { color: colors.success || colors.primary }]}>
                          {t('skills.installed')}
                        </Text>
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleInstallFromHub(skill)}
                          disabled={installingId === skill.id}
                          accessibilityRole="button"
                          accessibilityLabel={t('skills.install')}
                        >
                          {installingId === skill.id ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <Download size={20} color={colors.primary} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                    {skill.description ? (
                      <Text style={styles.description} numberOfLines={2}>
                        {skill.description}
                      </Text>
                    ) : null}
                    <View style={styles.browseMetaRow}>
                      <Text style={styles.metaText}>
                        {t('skills.downloads', { count: String(skill.downloads) })}
                      </Text>
                      {skill.version ? (
                        <Text style={styles.metaText}>
                          {t('common.versionShort', { version: skill.version })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              }}
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

      {/* Add Skill Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('skills.addSkill')}</Text>
              <TouchableOpacity
                onPress={() => setShowAddModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelp}>{t('skills.addSkillHint')}</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, addMode === 'url' && styles.modeBtnActive]}
                onPress={() => setAddMode('url')}
              >
                <Text style={[styles.modeBtnText, addMode === 'url' && styles.modeBtnTextActive]}>
                  {t('skills.installFromUrl')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, addMode === 'manual' && styles.modeBtnActive]}
                onPress={() => setAddMode('manual')}
              >
                <Text
                  style={[styles.modeBtnText, addMode === 'manual' && styles.modeBtnTextActive]}
                >
                  {t('skills.createManually')}
                </Text>
              </TouchableOpacity>
            </View>

            {addMode === 'url' ? (
              <>
                <Text style={styles.modalCaption}>{t('skills.installUrlHint')}</Text>
                <TextInput
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
                  style={styles.modalInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder={t('skills.skillNamePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                />
                <TextInput
                  style={[styles.modalInput, { height: 80 }]}
                  value={newDescription}
                  onChangeText={setNewDescription}
                  placeholder={t('skills.descriptionPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                />
                <Text style={styles.modalCaption}>{t('skills.systemPrompt')}</Text>
                <TextInput
                  style={[styles.modalInput, { height: 96 }]}
                  value={newSystemPrompt}
                  onChangeText={setNewSystemPrompt}
                  placeholder={t('skills.systemPromptPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                />
                <Text style={styles.modalCaption}>{t('skills.toolNames')}</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newToolNames}
                  onChangeText={setNewToolNames}
                  placeholder={t('skills.toolNamesPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                />
                <Text style={styles.modalCaption}>{t('skills.requiredSecretsLabel')}</Text>
                <TextInput
                  style={styles.modalInput}
                  value={newRequiredSecrets}
                  onChangeText={setNewRequiredSecrets}
                  placeholder={t('skills.requiredSecretsPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="characters"
                />
              </>
            )}
            <TouchableOpacity style={styles.modalButton} onPress={handleAddSkill}>
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

      <Modal
        visible={Boolean(setupEntry)}
        transparent
        animationType="slide"
        onRequestClose={closeSetupModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {setupEntry ? t('skills.setupSkill', { name: setupEntry.metadata.name }) : ''}
              </Text>
              <TouchableOpacity
                onPress={closeSetupModal}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={20} color={colors.textSecondary} />
              </TouchableOpacity>
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
                        style={styles.secondaryButton}
                        onPress={() => (navigation as any).navigate?.('Settings')}
                      >
                        <Text style={styles.secondaryButtonText}>{t('skills.openSettings')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalButton}
                        onPress={() => {
                          void handleSaveSetup();
                        }}
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
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    list: {
      padding: 16,
      flexGrow: 1,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cardTitleSection: {
      flex: 1,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    version: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 1,
    },
    description: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginTop: 8,
    },
    helperText: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 17,
      marginTop: 8,
    },
    surfaceRow: {
      marginTop: 10,
      gap: 8,
    },
    surfaceLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    surfaceChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    surfaceChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.subtleBorder,
    },
    surfaceChipText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    browseMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 10,
    },
    metaText: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    toolsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
    },
    toolsText: {
      fontSize: 12,
      color: colors.textTertiary,
    },
    statusPill: {
      marginTop: 10,
      alignSelf: 'flex-start',
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    statusPillText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.warning || colors.primary,
    },
    setupRow: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    setupText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
    },
    setupButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    setupButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 12,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.subtleBorder,
    },
    source: {
      fontSize: 11,
      color: colors.textTertiary,
      textTransform: 'capitalize',
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      marginTop: 60,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 16,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    browseIntroCard: {
      marginBottom: 12,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    browseIntroTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    browseIntroText: {
      marginTop: 6,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    modalHelp: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    modalCaption: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 8,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    modeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    modeBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    modeBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    modeBtnTextActive: {
      color: colors.primary,
    },
    modalInput: {
      backgroundColor: colors.inputBackground,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      marginBottom: 12,
    },
    modalButton: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    modalButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    secondaryButton: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 8,
      backgroundColor: colors.background,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
    },
    tabBtnActive: {
      backgroundColor: colors.primarySoft || colors.primary + '22',
    },
    tabText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    tabTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    browseContainer: {
      flex: 1,
    },
    searchRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 8,
      alignItems: 'center',
    },
    searchBtn: {
      padding: 10,
    },
    listFooter: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    secretLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    secretHint: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.textTertiary,
      marginBottom: 8,
    },
    setupLoader: {
      paddingVertical: 24,
    },
    setupFooter: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
  });
