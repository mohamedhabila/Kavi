import { ChevronRight, CloudSun, Globe, Plus } from 'lucide-react-native';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { buildExpoProjectSurfaces } from '../../features/expo/projectSurfaces';
import type { AppPalette } from '../../theme/useAppTheme';
import type { ExpoAccountConfig, ExpoProjectConfig, SshTargetConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type SettingsExpoSurfacesProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
  sshTargets: SshTargetConfig[];
  handleNewExpoAccount: () => void;
  handleEditExpoAccount: (account: ExpoAccountConfig) => void;
  handleSyncExpoAccount: () => void | Promise<void>;
  handleEditExpoProject: (project: ExpoProjectConfig) => void;
};

export const SettingsExpoSurfaces: React.FC<SettingsExpoSurfacesProps> = ({
  colors,
  styles,
  t,
  expoAccounts,
  expoProjects,
  sshTargets,
  handleNewExpoAccount,
  handleEditExpoAccount,
  handleSyncExpoAccount,
  handleEditExpoProject,
}) => {
  const projectSurfaces = buildExpoProjectSurfaces(expoProjects, expoAccounts, { sshTargets }, t);

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('settings.expoAccounts')}</Text>
        <TouchableOpacity
          onPress={handleNewExpoAccount}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addExpoAccount')}
        >
          <Plus size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {expoAccounts.map((account) => (
        <TouchableOpacity
          key={account.id}
          style={styles.listItem}
          onPress={() => handleEditExpoAccount(account)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.editNamedExpoAccount', { name: account.name })}
        >
          <CloudSun size={18} color={account.enabled ? colors.primary : colors.textTertiary} />
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{account.name}</Text>
            <Text style={styles.listItemSubtitle}>{account.owner}</Text>
            <Text style={styles.listItemSubtitle}>
              {account.accountType === 'robot'
                ? t('settings.expoAccountTokenRobot')
                : t('settings.expoAccountTokenPersonal')}{' '}
              · {account.tokenRef ? t('settings.tokenSaved') : t('settings.tokenMissing')}
            </Text>
            <Text style={styles.listItemSubtitle}>
              {account.lastProjectSyncError
                ? `Sync failed · ${account.lastProjectSyncError}`
                : `Projects synced · ${account.syncedProjectCount || 0}`}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ))}

      {expoAccounts.length === 0 ? (
        <Text style={styles.emptyText}>{t('settings.noExpoAccounts')}</Text>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('settings.expoProjects')}</Text>
        <TouchableOpacity
          onPress={() =>
            expoAccounts.length > 0 ? void handleSyncExpoAccount() : handleNewExpoAccount()
          }
          accessibilityRole="button"
          accessibilityLabel={
            expoAccounts.length > 0 ? 'Sync Expo projects' : t('settings.addExpoAccount')
          }
        >
          <Plus size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {projectSurfaces.map((surface) => (
        <TouchableOpacity
          key={surface.id}
          style={styles.listItem}
          onPress={() => handleEditExpoProject(surface.project)}
          accessibilityRole="button"
          accessibilityLabel={t('settings.editNamedExpoProject', { name: surface.name })}
        >
          <Globe size={18} color={surface.project.enabled ? colors.primary : colors.textTertiary} />
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{surface.name}</Text>
            <Text style={styles.listItemSubtitle}>{surface.ownerSlugLabel}</Text>
            <Text style={styles.listItemSubtitle}>
              {surface.modeLabel} · {surface.readinessLabel}
            </Text>
            {surface.webUrl ? <Text style={styles.listItemSubtitle}>{surface.webUrl}</Text> : null}
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      ))}

      {expoProjects.length === 0 ? (
        <Text style={styles.emptyText}>
          {expoAccounts.length > 0
            ? 'No Expo projects synced yet. Sync a linked account to import its existing Expo projects.'
            : t('settings.noExpoProjects')}
        </Text>
      ) : null}
    </>
  );
};
