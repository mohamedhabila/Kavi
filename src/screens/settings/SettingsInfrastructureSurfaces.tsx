import { ChevronRight, Cpu, Plus, Server, ShieldCheck } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { getBrowserProviderLabel } from '../../services/browser/providers/labels';
import { getBrowserProviderReadiness } from '../../services/browser/providers/readiness';
import { getSshTargetReadiness } from '../../services/ssh/connector';
import {
  getWorkspaceProviderLabel,
  getWorkspaceTargetReadiness,
} from '../../services/workspaces/connector';
import type { AppPalette } from '../../theme/useAppTheme';
import type {
  BrowserProviderConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsInfrastructureSurfacesProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  sshTargets: SshTargetConfig[];
  workspaceTargets: WorkspaceTargetConfig[];
  browserProviders: BrowserProviderConfig[];
  getSshTargetAuthModeLabel: (target: SshTargetConfig) => string;
  getSshHostKeyPolicyLabel: (target: SshTargetConfig) => string;
  getBrowserProviderAuthLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  handleNewSsh: () => void;
  handleEditSsh: (target: SshTargetConfig) => void;
  handleNewWorkspace: () => void;
  handleEditWorkspace: (target: WorkspaceTargetConfig) => void;
  handleNewBrowserProvider: () => void;
  handleEditBrowserProvider: (provider: BrowserProviderConfig) => void;
};

export const SettingsInfrastructureSurfaces: React.FC<SettingsInfrastructureSurfacesProps> = ({
  colors,
  styles,
  t,
  sshTargets,
  workspaceTargets,
  browserProviders,
  getSshTargetAuthModeLabel,
  getSshHostKeyPolicyLabel,
  getBrowserProviderAuthLabel,
  handleNewSsh,
  handleEditSsh,
  handleNewWorkspace,
  handleEditWorkspace,
  handleNewBrowserProvider,
  handleEditBrowserProvider,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.sshTargets')}</Text>
      <TouchableOpacity
        onPress={handleNewSsh}
        accessibilityRole="button"
        accessibilityLabel={t('settings.addSshTarget')}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    {sshTargets.map((target) => (
      <TouchableOpacity
        key={target.id}
        style={styles.listItem}
        onPress={() => handleEditSsh(target)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.editSshTarget')}
      >
        <Server size={18} color={target.enabled ? colors.primary : colors.textTertiary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{target.name}</Text>
          <Text
            style={styles.listItemSubtitle}
          >{`${target.username}@${target.host}:${target.port}`}</Text>
          {target.remoteRoot ? (
            <Text style={styles.listItemSubtitle}>{target.remoteRoot}</Text>
          ) : null}
          <Text style={styles.listItemSubtitle}>
            {getSshTargetAuthModeLabel(target)} · {getSshHostKeyPolicyLabel(target)} ·{' '}
            {getSshTargetReadiness(target).launchable
              ? t('remoteWork.statusReady')
              : t('remoteWork.statusSetupRequired')}
          </Text>
          {target.trustedHostFingerprint ? (
            <Text style={styles.listItemSubtitle}>{target.trustedHostFingerprint}</Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    ))}

    {sshTargets.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noSshTargets')}</Text>
    ) : null}

    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.workspaceTargets')}</Text>
      <TouchableOpacity
        onPress={handleNewWorkspace}
        accessibilityRole="button"
        accessibilityLabel={t('settings.addWorkspaceTarget')}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    {workspaceTargets.map((target) => (
      <TouchableOpacity
        key={target.id}
        style={styles.listItem}
        onPress={() => handleEditWorkspace(target)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.editWorkspaceTarget')}
      >
        <Cpu size={18} color={target.enabled ? colors.primary : colors.textTertiary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{target.name}</Text>
          <Text style={styles.listItemSubtitle}>{target.rootPath}</Text>
          <Text style={styles.listItemSubtitle}>
            {target.baseUrl?.trim() || t('remoteWork.notConfigured')}
          </Text>
          <Text style={styles.listItemSubtitle}>
            {getWorkspaceProviderLabel(target.provider)} ·{' '}
            {getWorkspaceTargetReadiness(target).launchable
              ? t('remoteWork.statusReady')
              : t('remoteWork.statusSetupRequired')}
          </Text>
          {(target.configRoots || []).length > 0 ? (
            <Text style={styles.listItemSubtitle}>
              {t('settings.workspaceConfigRootsCount', {
                count: String((target.configRoots || []).length),
              })}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    ))}

    {workspaceTargets.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noWorkspaceTargets')}</Text>
    ) : null}

    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('settings.browserProviders')}</Text>
      <TouchableOpacity
        onPress={handleNewBrowserProvider}
        accessibilityRole="button"
        accessibilityLabel={t('settings.addBrowserProvider')}
      >
        <Plus size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>

    {browserProviders.map((provider) => (
      <TouchableOpacity
        key={provider.id}
        style={styles.listItem}
        onPress={() => handleEditBrowserProvider(provider)}
        accessibilityRole="button"
        accessibilityLabel={t('settings.editBrowserProvider')}
      >
        <ShieldCheck size={18} color={provider.enabled ? colors.primary : colors.textTertiary} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{provider.name}</Text>
          <Text style={styles.listItemSubtitle}>{getBrowserProviderLabel(provider.provider)}</Text>
          <Text style={styles.listItemSubtitle}>
            {provider.baseUrl?.trim() || t('remoteWork.notConfigured')}
          </Text>
          <Text style={styles.listItemSubtitle}>
            {getBrowserProviderAuthLabel(provider.authMode)} ·{' '}
            {getBrowserProviderReadiness(provider).launchable
              ? t('remoteWork.statusReady')
              : t('remoteWork.statusSetupRequired')}
          </Text>
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    ))}

    {browserProviders.length === 0 ? (
      <Text style={styles.emptyText}>{t('settings.noBrowserProviders')}</Text>
    ) : null}
  </>
);
