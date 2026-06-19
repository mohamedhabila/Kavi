// ---------------------------------------------------------------------------
// Kavi — Skills Manager Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSkillsStore } from '../services/skills/manager';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  getSkillCompatibility,
  getSkillRequiredSecrets,
  getSkillSecretField,
} from '../services/skills/manifest';
import { buildSkillEligibilityContext } from '../services/skills/eligibility';
import { deleteSecure, getSecure, saveSecure } from '../services/storage/SecureStorage';
import { useAppTheme } from '../theme/useAppTheme';
import { createSkillsScreenStyles as createStyles } from './skills/skillsScreenStyles';
import { SkillsScreenView } from './skills/SkillsScreenView';
import { useTranslation } from '../i18n/useTranslation';
import { generateId } from '../utils/id';
import { listClawHubSkills, searchClawHub } from '../services/clawhub/apiClient';
import { installSkillFromHub, installSkillFromUrl } from '../services/clawhub/installWorkflow';
import type { SkillEntry } from '../services/skills/types';
import type { ClawHubSkill } from '../types/clawhub';
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

  const handleOpenSettings = useCallback(() => {
    (navigation as any).navigate?.('Settings');
  }, [navigation]);

  return (
    <SkillsScreenView
      activeTab={activeTab}
      addMode={addMode}
      browserProviders={browserProviders}
      closeSetupModal={closeSetupModal}
      colors={colors}
      eligibilityContext={eligibilityContext}
      entries={entries}
      getCompatibilityPillLabel={getCompatibilityPillLabel}
      handleAddSkill={handleAddSkill}
      handleBack={handleBack}
      handleDelete={handleDelete}
      handleInstallFromHub={handleInstallFromHub}
      handleOpenSettings={handleOpenSettings}
      handleOpenSetup={handleOpenSetup}
      handleSaveSetup={handleSaveSetup}
      hubLoading={hubLoading}
      hubLoadingMore={hubLoadingMore}
      hubQuery={hubQuery}
      hubSkills={hubSkills}
      installingId={installingId}
      installUrl={installUrl}
      loadHubSkills={loadHubSkills}
      mcpServers={mcpServers}
      newDescription={newDescription}
      newName={newName}
      newRequiredSecrets={newRequiredSecrets}
      newSystemPrompt={newSystemPrompt}
      newToolNames={newToolNames}
      secretStatus={secretStatus}
      setActiveTab={setActiveTab}
      setAddMode={setAddMode}
      setHubQuery={setHubQuery}
      setInstallUrl={setInstallUrl}
      setNewDescription={setNewDescription}
      setNewName={setNewName}
      setNewRequiredSecrets={setNewRequiredSecrets}
      setNewSystemPrompt={setNewSystemPrompt}
      setNewToolNames={setNewToolNames}
      setSetupValues={setSetupValues}
      setShowAddModal={setShowAddModal}
      setupEntry={setupEntry}
      setupLoading={setupLoading}
      setupSaving={setupSaving}
      setupValues={setupValues}
      showAddModal={showAddModal}
      sshTargets={sshTargets}
      styles={styles}
      t={t}
      toggleEntry={toggleEntry}
      workspaceTargets={workspaceTargets}
    />
  );
};
